import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '../services/api';
import syncManager from '../services/syncManager';
import { COLORS } from '../theme/colors';

export default function HomeScreen({ navigation, isAdmin }) {
  console.log('[HOMESCREEN] Component rendering...', 'isAdmin:', isAdmin);
  const [characters, setCharacters] = useState([]);
  const [progress, setProgress] = useState({ characterProgress: {}, compoundProgress: {} });
  const [customData, setCustomData] = useState({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    console.log('[HOMESCREEN] useEffect running, calling loadData...');
    loadData();
  }, []);

  const loadData = async () => {
    try {
      // Load characters from bundled data (no network call needed!)
      const charData = require('../data/characters.json');
      setCharacters(Object.values(charData));

      // Load custom character data (edited meanings)
      const customCharData = await AsyncStorage.getItem('@customCharacterData');
      if (customCharData) {
        setCustomData(JSON.parse(customCharData));
      }

      // Load progress from cache first
      const cachedProgress = await AsyncStorage.getItem('@progress');
      const lastSync = await AsyncStorage.getItem('@progress_last_sync');
      const now = Date.now();

      if (cachedProgress) {
        setProgress(JSON.parse(cachedProgress));
        setLoading(false); // Show cached data immediately
      }

      // Only fetch from server if cache is older than 30 seconds
      const shouldSync = !lastSync || (now - parseInt(lastSync)) > 30000;

      if (shouldSync) {
        try {
          const result = await api.getProgress();
          console.log('[HOME] Synced progress from server');
          // Server returns progress object directly
          if (result && typeof result === 'object') {
            setProgress(result);
            await AsyncStorage.setItem('@progress', JSON.stringify(result));
            await AsyncStorage.setItem('@progress_last_sync', now.toString());
          }
        } catch (error) {
          console.log('[HOME] Using cached progress (offline or error)');
        }
      } else {
        console.log('[HOME] Using cached progress (fresh)');
      }

      setLoading(false);
    } catch (error) {
      console.error('[HOME] Error loading data:', error);
      setLoading(false);
    }
  };

  const toggleCharacterKnown = async (char) => {
    const isKnown = progress.characterProgress[char]?.known || false;
    const newProgress = {
      ...progress,
      characterProgress: {
        ...progress.characterProgress,
        [char]: {
          ...progress.characterProgress[char],
          known: !isKnown,
        },
      },
    };

    setProgress(newProgress);
    await AsyncStorage.setItem('@progress', JSON.stringify(newProgress));

    // Queue sync
    await syncManager.queueAction({
      type: 'SAVE_PROGRESS',
      data: newProgress,
    });
  };

  const filteredCharacters = characters.filter(c =>
    c.char.includes(search) ||
    c.pinyin.toLowerCase().includes(search.toLowerCase()) ||
    c.meanings.some(m => m.toLowerCase().includes(search.toLowerCase()))
  );

  const renderCharacter = ({ item }) => {
    const isKnown = progress.characterProgress[item.char]?.known || false;

    // Check if there's a custom meaning for this character
    const customMeanings = customData[item.char]?.meanings;
    const displayMeaning = customMeanings && customMeanings.length > 0
      ? customMeanings[0]
      : item.meanings[0];

    return (
      <TouchableOpacity
        style={[styles.charCard, isKnown && styles.charCardKnown]}
        onPress={() => navigation.navigate('CharacterDetail', { character: item })}
        onLongPress={() => toggleCharacterKnown(item.char)}
      >
        <Text style={styles.charText}>{item.char}</Text>
        <Text style={styles.pinyinText}>{item.pinyin}</Text>
        <Text style={styles.meaningText} numberOfLines={2}>
          {displayMeaning}
        </Text>
        {isKnown && <Text style={styles.knownBadge}>✓</Text>}
      </TouchableOpacity>
    );
  };

  console.log('[HOMESCREEN] About to render, loading:', loading, 'type:', typeof loading);

  if (loading) {
    console.log('[HOMESCREEN] Rendering loading state...');
    return (
      <View style={styles.centered}>
        <Text>Loading...</Text>
      </View>
    );
  }

  console.log('[HOMESCREEN] Rendering main view...');
  return (
    <View style={styles.container}>
      <TextInput
        style={styles.searchInput}
        placeholder="Search characters..."
        value={search}
        onChangeText={setSearch}
      />

      {isAdmin && (
        <View style={styles.adminButtons}>
          <TouchableOpacity
            style={styles.adminButton}
            onPress={() => navigation.navigate('AddCharacter')}
          >
            <Text style={styles.adminButtonText}>+ Add Character</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.adminButton}
            onPress={() => navigation.navigate('AddCompound')}
          >
            <Text style={styles.adminButtonText}>+ Add Compound</Text>
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        data={filteredCharacters}
        renderItem={renderCharacter}
        keyExtractor={item => item.char}
        numColumns={3}
        contentContainerStyle={styles.grid}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.lightGray,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchInput: {
    backgroundColor: COLORS.white,
    margin: 16,
    marginBottom: 8,
    padding: 16,
    borderRadius: 16,
    fontSize: 17,
    borderWidth: 0,
    borderBottomWidth: 3,
    borderBottomColor: COLORS.primary,
    color: COLORS.textDark,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  grid: {
    padding: 10,
    paddingBottom: 30,
  },
  charCard: {
    flex: 1,
    margin: 6,
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 16,
    paddingTop: 20,
    paddingBottom: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.primaryLight,
    minHeight: 130,
    shadowColor: COLORS.textDark,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
    position: 'relative',
  },
  charCardKnown: {
    backgroundColor: COLORS.greenLight,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.success,
    shadowColor: COLORS.success,
    shadowOpacity: 0.15,
  },
  charText: {
    fontSize: 48,
    fontWeight: '700',
    marginBottom: 6,
    color: COLORS.textDark,
    letterSpacing: 1,
  },
  pinyinText: {
    fontSize: 15,
    color: COLORS.primary,
    marginBottom: 6,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  meaningText: {
    fontSize: 11,
    color: COLORS.textMedium,
    textAlign: 'center',
    lineHeight: 15,
    fontWeight: '500',
  },
  knownBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    fontSize: 24,
    color: COLORS.success,
  },
  adminButtons: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 10,
  },
  adminButton: {
    flex: 1,
    backgroundColor: COLORS.primary,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  adminButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600',
  },
});
