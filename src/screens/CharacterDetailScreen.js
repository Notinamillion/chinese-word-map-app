import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import syncManager from '../services/syncManager';

export default function CharacterDetailScreen({ route }) {
  const { character } = route.params;
  const [charProgress, setCharProgress] = useState(0);

  useEffect(() => {
    loadProgress();
  }, []);

  const loadProgress = async () => {
    try {
      const cachedProgress = await AsyncStorage.getItem('@progress');
      if (cachedProgress) {
        const progressData = JSON.parse(cachedProgress);
        // Handle both old and new progress formats
        const progress = progressData.characterProgress?.[character.char]?.progress ||
                        progressData[character.char] ||
                        0;
        setCharProgress(progress);
      }
    } catch (error) {
      console.error('[DETAIL] Error loading progress:', error);
    }
  };

  const updateProgress = async (newProgress) => {
    try {
      setCharProgress(newProgress);

      // Update cached progress with new format
      const cachedProgress = await AsyncStorage.getItem('@progress');
      const progressData = cachedProgress ? JSON.parse(cachedProgress) : { characterProgress: {}, compoundProgress: {} };

      if (!progressData.characterProgress) {
        progressData.characterProgress = {};
      }

      progressData.characterProgress[character.char] = {
        ...progressData.characterProgress[character.char],
        progress: newProgress
      };

      await AsyncStorage.setItem('@progress', JSON.stringify(progressData));

      // Queue sync action
      await syncManager.queueAction({
        type: 'SAVE_PROGRESS',
        data: progressData,
      });

      Alert.alert('Success', `Progress set to ${newProgress}%`);
    } catch (error) {
      console.error('[DETAIL] Error updating progress:', error);
      Alert.alert('Error', 'Could not update progress');
    }
  };

  const getProgressColor = () => {
    if (charProgress === 0) return '#999';
    if (charProgress === 50) return '#ff9800';
    return '#4caf50';
  };

  return (
    <ScrollView style={styles.container}>
      {/* Character Display */}
      <View style={styles.characterSection}>
        <Text style={styles.character}>{character.char}</Text>
        <Text style={styles.pinyin}>{character.pinyin}</Text>
      </View>

      {/* Progress Bar */}
      <View style={styles.progressSection}>
        <Text style={styles.sectionTitle}>Learning Progress</Text>
        <View style={styles.progressBar}>
          <View
            style={[
              styles.progressFill,
              { width: `${charProgress}%`, backgroundColor: getProgressColor() }
            ]}
          />
        </View>
        <Text style={[styles.progressText, { color: getProgressColor() }]}>
          {charProgress}%
        </Text>
      </View>

      {/* Progress Buttons */}
      <View style={styles.buttonSection}>
        <TouchableOpacity
          style={[styles.progressButton, styles.notStarted]}
          onPress={() => updateProgress(0)}
        >
          <Text style={styles.buttonText}>Not Started (0%)</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.progressButton, styles.learning]}
          onPress={() => updateProgress(50)}
        >
          <Text style={styles.buttonText}>Learning (50%)</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.progressButton, styles.mastered]}
          onPress={() => updateProgress(100)}
        >
          <Text style={styles.buttonText}>Mastered (100%)</Text>
        </TouchableOpacity>
      </View>

      {/* Meanings */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Meanings</Text>
        {character.meanings && character.meanings.map((meaning, index) => (
          <Text key={index} style={styles.meaningText}>
            • {meaning}
          </Text>
        ))}
      </View>

      {/* Compounds */}
      {character.compounds && character.compounds.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Compound Words</Text>
          {character.compounds.map((compound, index) => (
            <View key={index} style={styles.compoundItem}>
              <Text style={styles.compoundWord}>{compound.word}</Text>
              <Text style={styles.compoundTraditional}>
                {compound.traditional}
              </Text>
              <Text style={styles.compoundPinyin}>{compound.pinyin}</Text>
              {compound.meanings && compound.meanings.map((meaning, idx) => (
                <Text key={idx} style={styles.compoundMeaning}>
                  • {meaning}
                </Text>
              ))}
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  characterSection: {
    backgroundColor: '#fff',
    padding: 30,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  character: {
    fontSize: 120,
    fontWeight: 'bold',
    color: '#333',
  },
  pinyin: {
    fontSize: 24,
    color: '#667eea',
    marginTop: 10,
  },
  progressSection: {
    backgroundColor: '#fff',
    padding: 20,
    marginTop: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
  },
  progressBar: {
    height: 20,
    backgroundColor: '#e0e0e0',
    borderRadius: 10,
    overflow: 'hidden',
    marginVertical: 10,
  },
  progressFill: {
    height: '100%',
  },
  progressText: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  buttonSection: {
    backgroundColor: '#fff',
    padding: 20,
    marginTop: 10,
  },
  progressButton: {
    padding: 15,
    borderRadius: 8,
    marginVertical: 5,
    alignItems: 'center',
  },
  notStarted: {
    backgroundColor: '#999',
  },
  learning: {
    backgroundColor: '#ff9800',
  },
  mastered: {
    backgroundColor: '#4caf50',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  section: {
    backgroundColor: '#fff',
    padding: 20,
    marginTop: 10,
    marginBottom: 10,
  },
  meaningText: {
    fontSize: 16,
    color: '#333',
    marginVertical: 3,
    lineHeight: 24,
  },
  compoundItem: {
    borderLeftWidth: 3,
    borderLeftColor: '#667eea',
    paddingLeft: 15,
    marginVertical: 10,
  },
  compoundWord: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  compoundTraditional: {
    fontSize: 18,
    color: '#666',
    marginTop: 2,
  },
  compoundPinyin: {
    fontSize: 16,
    color: '#667eea',
    marginTop: 4,
  },
  compoundMeaning: {
    fontSize: 14,
    color: '#333',
    marginTop: 6,
    lineHeight: 20,
  },
});
