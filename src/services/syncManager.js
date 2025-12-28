import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import api from './api';

const SYNC_QUEUE_KEY = '@syncQueue';
const SYNC_INTERVAL = 10000; // 10 seconds

class SyncManager {
  constructor() {
    this.syncQueue = [];
    this.isSyncing = false;
    this.isOnline = true;
    this.syncInterval = null;
    this.listeners = [];
  }

  // Initialize sync manager
  async initialize() {
    // Load queued actions from storage
    await this.loadQueueFromStorage();

    // Listen for network changes
    this.netInfoUnsubscribe = NetInfo.addEventListener(state => {
      const wasOffline = !this.isOnline;
      this.isOnline = Boolean(state.isConnected);

      // If just came online, trigger sync
      if (wasOffline && this.isOnline) {
        console.log('[SYNC] Network restored, syncing...');
        this.processQueue();
      }

      // Notify listeners
      this.notifyListeners({ online: this.isOnline });
    });

    // Start auto-sync interval
    this.startAutoSync();

    // Get initial network state
    const netState = await NetInfo.fetch();
    this.isOnline = Boolean(netState.isConnected);
  }

  // Add listener for sync status changes
  addListener(callback) {
    this.listeners.push(callback);
  }

  removeListener(callback) {
    this.listeners = this.listeners.filter(l => l !== callback);
  }

  notifyListeners(data) {
    this.listeners.forEach(callback => callback(data));
  }

  // Load queue from storage
  async loadQueueFromStorage() {
    try {
      const queueJson = await AsyncStorage.getItem(SYNC_QUEUE_KEY);
      if (queueJson) {
        this.syncQueue = JSON.parse(queueJson);
        console.log('[SYNC] Loaded', this.syncQueue.length, 'queued actions');
      }
    } catch (error) {
      console.error('[SYNC] Error loading queue:', error);
    }
  }

  // Save queue to storage
  async saveQueueToStorage() {
    try {
      await AsyncStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(this.syncQueue));
    } catch (error) {
      console.error('[SYNC] Error saving queue:', error);
    }
  }

  // Add action to queue
  async queueAction(action) {
    this.syncQueue.push({
      ...action,
      timestamp: Date.now(),
      attempts: 0,
    });

    await this.saveQueueToStorage();
    console.log('[SYNC] Queued action:', action.type, '- Queue size:', this.syncQueue.length);

    // Try to sync immediately if online
    if (this.isOnline) {
      this.processQueue();
    }
  }

  // Start auto-sync interval
  startAutoSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    this.syncInterval = setInterval(async () => {
      if (this.isOnline && this.syncQueue.length > 0) {
        await this.processQueue();
      }
    }, SYNC_INTERVAL);
  }

  // Stop auto-sync
  stopAutoSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  // Process sync queue
  async processQueue() {
    if (this.isSyncing || this.syncQueue.length === 0) {
      return;
    }

    this.isSyncing = true;
    const startingQueueSize = this.syncQueue.length;

    console.log('[SYNC] Processing queue:', startingQueueSize, 'actions');

    while (this.syncQueue.length > 0) {
      const action = this.syncQueue[0];

      try {
        // Execute the action
        await this.executeAction(action);

        // Remove from queue on success
        this.syncQueue.shift();
        await this.saveQueueToStorage();

        console.log('[SYNC] Synced action:', action.type, '- Remaining:', this.syncQueue.length);
      } catch (error) {
        console.error('[SYNC] Failed to sync action:', action.type, error.message);

        // Increment attempt counter
        this.syncQueue[0].attempts = (this.syncQueue[0].attempts || 0) + 1;

        // If too many attempts, remove it
        if (this.syncQueue[0].attempts >= 5) {
          console.error('[SYNC] Giving up on action after 5 attempts:', action.type);
          this.syncQueue.shift();
          await this.saveQueueToStorage();
        }

        // Stop processing on error
        break;
      }
    }

    this.isSyncing = false;

    if (startingQueueSize > 0 && this.syncQueue.length === 0) {
      console.log('[SYNC] ✓ All actions synced successfully');
      this.notifyListeners({ synced: true, queueSize: 0 });
    } else if (this.syncQueue.length > 0) {
      this.notifyListeners({ synced: false, queueSize: this.syncQueue.length });
    }
  }

  // Execute a single action
  async executeAction(action) {
    switch (action.type) {
      case 'SAVE_PROGRESS':
        await api.saveProgress(action.data);
        break;

      case 'ADD_CUSTOM_WORD':
        await api.addCustomWord(action.data.word, action.data.pinyin, action.data.meanings);
        break;

      case 'DELETE_CUSTOM_WORD':
        await api.deleteCustomWord(action.data.id);
        break;

      case 'ADD_SENTENCE':
        await api.addSentence(action.data.chinese, action.data.pinyin, action.data.english);
        break;

      case 'DELETE_SENTENCE':
        await api.deleteSentence(action.data.id);
        break;

      case 'SAVE_WORD_EDIT':
        await api.saveWordEdit(action.data.word, action.data.wordType, action.data.meanings);
        break;

      default:
        console.warn('[SYNC] Unknown action type:', action.type);
    }
  }

  // Cleanup
  destroy() {
    this.stopAutoSync();
    if (this.netInfoUnsubscribe) {
      this.netInfoUnsubscribe();
    }
  }

  // Get queue size
  getQueueSize() {
    return this.syncQueue.length;
  }

  // Get online status
  getOnlineStatus() {
    return this.isOnline;
  }
}

export default new SyncManager();
