import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

// API Configuration
const API_BASE_URL = 'http://192.168.1.222:3000';

// Create axios instance
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true, // Important: Send cookies with requests
});

// API Service
class APIService {
  // Authentication
  async login(username, password) {
    try {
      const response = await apiClient.post('/api/auth/login', {
        username,
        password,
      });

      if (response.data.success) {
        await AsyncStorage.setItem('currentUser', username);
        // Store isAdmin, default to false if undefined
        const isAdmin = response.data.isAdmin || false;
        await AsyncStorage.setItem('isAdmin', JSON.stringify(isAdmin));
      }

      return response.data;
    } catch (error) {
      console.error('[API] Login error:', error);
      throw error;
    }
  }

  async register(username, email, password) {
    try {
      const response = await apiClient.post('/api/auth/register', {
        username,
        email,
        password,
      });
      return response.data;
    } catch (error) {
      console.error('[API] Register error:', error);
      throw error;
    }
  }

  async logout() {
    try {
      await apiClient.post('/api/auth/logout');
      await AsyncStorage.removeItem('currentUser');
      await AsyncStorage.removeItem('isAdmin');
    } catch (error) {
      console.error('[API] Logout error:', error);
    }
  }

  // Health check
  async checkHealth() {
    try {
      const response = await apiClient.get('/api/health', { timeout: 3000 });
      return response.status === 200;
    } catch (error) {
      // Fallback to progress endpoint if health doesn't exist
      try {
        const response = await apiClient.get('/api/progress', { timeout: 3000 });
        return response.status === 200 || response.status === 401;
      } catch (fallbackError) {
        return false;
      }
    }
  }

  // Progress
  async getProgress() {
    const response = await apiClient.get('/api/progress');
    return response.data;
  }

  async saveProgress(progressData) {
    const response = await apiClient.post('/api/progress', progressData);
    return response.data;
  }

  // Custom Words
  async getCustomWords() {
    const response = await apiClient.get('/api/custom-words');
    return response.data;
  }

  async addCustomWord(word, pinyin, meanings) {
    const response = await apiClient.post('/api/custom-words', {
      word,
      pinyin,
      meanings,
    });
    return response.data;
  }

  async deleteCustomWord(id) {
    const response = await apiClient.delete(`/api/custom-words/${id}`);
    return response.data;
  }

  // Sentences
  async getSentences() {
    const response = await apiClient.get('/api/sentences');
    return response.data;
  }

  async addSentence(chinese, pinyin, english) {
    const response = await apiClient.post('/api/sentences', {
      chinese,
      pinyin,
      english,
    });
    return response.data;
  }

  async deleteSentence(id) {
    const response = await apiClient.delete(`/api/sentences/${id}`);
    return response.data;
  }

  // Word Edits
  async getWordEdit(word, wordType) {
    const response = await apiClient.get(`/api/word-edits/${encodeURIComponent(word)}/${wordType}`);
    return response.data;
  }

  async saveWordEdit(word, wordType, meanings) {
    const response = await apiClient.post('/api/word-edits', {
      word,
      wordType,
      meanings,
    });
    return response.data;
  }

  // Characters (load from local file, not API)
  async getCharacters() {
    // Characters are bundled with the app
    return require('../data/characters.json');
  }
}

export default new APIService();
