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
        if (result.success) {
          setProgress(result.progress);
          await AsyncStorage.setItem('@progress', JSON.stringify(result.progress));
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
        onPress={() => {
          // TODO: Fix navigation to CharacterDetail - currently broken
          // navigation.navigate('CharacterDetail', { character: item })
          console.log('[HOME] Character clicked:', item.char);
        }}
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
    backgroundColor: '#f5f5f5',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchInput: {
    backgroundColor: '#fff',
    margin: 10,
    padding: 12,
    borderRadius: 8,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  grid: {
    padding: 5,
  },
  charCard: {
    flex: 1,
    margin: 5,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#7ED321',
    minHeight: 120,
  },
  charCardKnown: {
    backgroundColor: '#e8f5e9',
    borderColor: '#44dd44',
  },
  charText: {
    fontSize: 40,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  pinyinText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
  },
  meaningText: {
    fontSize: 11,
    color: '#999',
    textAlign: 'center',
  },
  knownBadge: {
    position: 'absolute',
    top: 5,
    right: 5,
    fontSize: 20,
    color: '#44dd44',
  },
});
