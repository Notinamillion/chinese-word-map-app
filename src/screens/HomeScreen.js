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

export default function HomeScreen({ navigation }) {
  console.log('[HOMESCREEN] Component rendering...');
  const [characters, setCharacters] = useState([]);
  const [progress, setProgress] = useState({ characterProgress: {}, compoundProgress: {} });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    console.log('[HOMESCREEN] useEffect running, calling loadData...');
    loadData();
  }, []);

  const loadData = async () => {
    try {
      // Load characters from bundled data
      const charData = require('../data/characters.json');
      setCharacters(Object.values(charData));

      // Load progress from cache first
      const cachedProgress = await AsyncStorage.getItem('@progress');
      if (cachedProgress) {
        setProgress(JSON.parse(cachedProgress));
      }

      // Then fetch from server if online
      try {
        const result = await api.getProgress();
        console.log('[HOME] Server progress response:', {
          hasResult: !!result,
          resultKeys: result ? Object.keys(result) : [],
          characterProgressCount: result?.characterProgress ? Object.keys(result.characterProgress).length : 0,
          compoundProgressCount: result?.compoundProgress ? Object.keys(result.compoundProgress).length : 0,
        });
        // Server returns progress object directly
        if (result && typeof result === 'object') {
          setProgress(result);
          await AsyncStorage.setItem('@progress', JSON.stringify(result));
          console.log('[HOME] Updated progress from server');
        }
      } catch (error) {
        console.log('[HOME] Using cached progress (offline)');
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

    return (
      <TouchableOpacity
        style={[styles.charCard, isKnown && styles.charCardKnown]}
        onPress={() => navigation.navigate('CharacterDetail', { character: item })}
        onLongPress={() => toggleCharacterKnown(item.char)}
      >
        <Text style={styles.charText}>{item.char}</Text>
        <Text style={styles.pinyinText}>{item.pinyin}</Text>
        <Text style={styles.meaningText} numberOfLines={2}>
          {item.meanings[0]}
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
    margin: 10,
    padding: 14,
    borderRadius: 12,
    fontSize: 16,
    borderWidth: 2,
    borderColor: COLORS.primaryLight,
    color: COLORS.textDark,
  },
  grid: {
    padding: 5,
  },
  charCard: {
    flex: 1,
    margin: 5,
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.mediumGray,
    minHeight: 120,
    shadowColor: COLORS.textLight,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  charCardKnown: {
    backgroundColor: COLORS.greenLight,
    borderColor: COLORS.success,
  },
  charText: {
    fontSize: 40,
    fontWeight: 'bold',
    marginBottom: 5,
    color: COLORS.textDark,
  },
  pinyinText: {
    fontSize: 14,
    color: COLORS.primary,
    marginBottom: 5,
    fontWeight: '600',
  },
  meaningText: {
    fontSize: 11,
    color: COLORS.textMedium,
    textAlign: 'center',
  },
  knownBadge: {
    position: 'absolute',
    top: 5,
    right: 5,
    fontSize: 20,
    color: COLORS.success,
  },
});
