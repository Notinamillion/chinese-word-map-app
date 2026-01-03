import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  Image,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import syncManager from '../services/syncManager';
import { COLORS } from '../theme/colors';
import api from '../services/api';

export default function CharacterDetailScreen({ route, isAdmin }) {
  const { character } = route.params;
  const [charProgress, setCharProgress] = useState(0);
  const [compoundKnownList, setCompoundKnownList] = useState({});
  const [customMeanings, setCustomMeanings] = useState(null);
  const [customImage, setCustomImage] = useState(null);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editedMeanings, setEditedMeanings] = useState('');

  // DEBUG: Log what character data we received
  console.log('[DETAIL] Character data received:', {
    char: character.char,
    pinyin: character.pinyin,
    hasMeanings: !!character.meanings,
    meaningsCount: character.meanings?.length || 0,
    meanings: character.meanings,
    hasCompounds: !!character.compounds,
    compoundsCount: character.compounds?.length || 0,
    allFields: Object.keys(character)
  });

  useEffect(() => {
    loadProgress();
    loadCustomData();
  }, []);

  const loadCustomData = async () => {
    try {
      // Load custom meanings and images from AsyncStorage
      const customData = await AsyncStorage.getItem('@customCharacterData');
      if (customData) {
        const parsed = JSON.parse(customData);
        const charData = parsed[character.char];
        if (charData) {
          setCustomMeanings(charData.meanings);
          setCustomImage(charData.image);
        }
      }
    } catch (error) {
      console.error('[DETAIL] Error loading custom data:', error);
    }
  };

  const handleEditMeanings = () => {
    const currentMeanings = customMeanings || character.meanings || [];
    setEditedMeanings(currentMeanings.join('\n'));
    setEditModalVisible(true);
  };

  const handleSaveMeanings = async () => {
    try {
      const newMeanings = editedMeanings.split('\n').filter(m => m.trim());

      // Save to AsyncStorage
      const customData = await AsyncStorage.getItem('@customCharacterData');
      const parsed = customData ? JSON.parse(customData) : {};

      if (!parsed[character.char]) {
        parsed[character.char] = {};
      }
      parsed[character.char].meanings = newMeanings;

      await AsyncStorage.setItem('@customCharacterData', JSON.stringify(parsed));
      setCustomMeanings(newMeanings);
      setEditModalVisible(false);

      // TODO: Sync to server
      Alert.alert('Success', 'Meanings updated successfully');
    } catch (error) {
      console.error('[DETAIL] Error saving meanings:', error);
      Alert.alert('Error', 'Failed to save meanings');
    }
  };

  const handleAddImage = () => {
    Alert.alert('Coming Soon', 'Image upload will be available soon. This will allow you to add memory aids for characters.');
  };

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

        // Load compound known status (website format: compoundProgress[char].known = [word1, word2])
        if (progressData.compoundProgress && progressData.compoundProgress[character.char]) {
          // Convert array format to lookup object for faster checking
          const knownWords = progressData.compoundProgress[character.char].known || [];
          const knownLookup = {};
          knownWords.forEach(word => {
            knownLookup[word] = true;
          });
          setCompoundKnownList(knownLookup);
        }
      }
    } catch (error) {
      console.error('[DETAIL] Error loading progress:', error);
    }
  };

  const isCompoundKnown = (word) => {
    return !!compoundKnownList[word];
  };

  const toggleCompoundKnown = async (word) => {
    try {
      const cachedProgress = await AsyncStorage.getItem('@progress');
      const progressData = cachedProgress ? JSON.parse(cachedProgress) : { characterProgress: {}, compoundProgress: {} };

      if (!progressData.compoundProgress) {
        progressData.compoundProgress = {};
      }

      const char = character.char;

      // Initialize character's compound progress if it doesn't exist
      if (!progressData.compoundProgress[char]) {
        progressData.compoundProgress[char] = {
          known: [],
          total: character.compounds ? character.compounds.length : 0
        };
      }

      // Toggle the known status (using website's structure: array of known words per character)
      const knownWords = progressData.compoundProgress[char].known || [];
      if (knownWords.includes(word)) {
        // Remove from known list
        progressData.compoundProgress[char].known = knownWords.filter(w => w !== word);
      } else {
        // Add to known list
        progressData.compoundProgress[char].known = [...knownWords, word];
      }

      await AsyncStorage.setItem('@progress', JSON.stringify(progressData));

      // Update UI state - convert array to lookup object for this character
      const knownLookup = {};
      progressData.compoundProgress[char].known.forEach(w => {
        knownLookup[w] = true;
      });
      setCompoundKnownList(knownLookup);

      // Queue sync
      await syncManager.queueAction({
        type: 'SAVE_PROGRESS',
        data: progressData,
      });

      console.log('[DETAIL] Toggled compound word:', word, '- known:', progressData.compoundProgress[char].known.includes(word));
    } catch (error) {
      console.error('[DETAIL] Error toggling compound:', error);
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

        {/* Meanings - directly below pinyin */}
        <View style={{ marginTop: 20, width: '100%' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <Text style={[styles.sectionTitle, { fontSize: 20, color: COLORS.textDark }]}>
              Meanings {customMeanings && '(Custom)'}
            </Text>
            {isAdmin && (
              <TouchableOpacity onPress={handleEditMeanings} style={styles.editButton}>
                <Text style={styles.editButtonText}>✏️ Edit</Text>
              </TouchableOpacity>
            )}
          </View>
          {(customMeanings || character.meanings)?.length > 0 ? (
            (customMeanings || character.meanings).map((meaning, index) => (
              <Text key={index} style={[styles.meaningText, { fontSize: 16, color: COLORS.textMedium }]}>
                • {meaning}
              </Text>
            ))
          ) : (
            <Text style={{ fontSize: 14, color: COLORS.error }}>No meanings available</Text>
          )}
          {isAdmin && (
            <TouchableOpacity onPress={handleAddImage} style={styles.addImageButton}>
              <Text style={styles.addImageButtonText}>📷 Add Memory Image</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Edit Meanings Modal */}
      <Modal
        visible={editModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setEditModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Edit Meanings for {character.char}</Text>
            <Text style={styles.modalHint}>Enter one meaning per line</Text>
            <TextInput
              style={styles.modalTextInput}
              value={editedMeanings}
              onChangeText={setEditedMeanings}
              multiline
              numberOfLines={10}
              placeholder="meaning 1&#10;meaning 2&#10;meaning 3"
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={() => setEditModalVisible(false)}
              >
                <Text style={styles.modalButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonSave]}
                onPress={handleSaveMeanings}
              >
                <Text style={[styles.modalButtonText, { color: COLORS.white }]}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Compounds */}
      {character.compounds && character.compounds.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Compound Words</Text>
          <Text style={styles.sectionHint}>Tap a word to add it to your quiz list</Text>
          {character.compounds.map((compound, index) => (
            <TouchableOpacity
              key={index}
              style={styles.compoundItem}
              onPress={() => toggleCompoundKnown(compound.word)}
            >
              <View style={styles.compoundHeader}>
                <View style={styles.compoundInfo}>
                  <Text style={styles.compoundWord}>{compound.word}</Text>
                  <Text style={styles.compoundTraditional}>
                    {compound.traditional}
                  </Text>
                  <Text style={styles.compoundPinyin}>{compound.pinyin}</Text>
                </View>
                <View style={[
                  styles.compoundCheckbox,
                  isCompoundKnown(compound.word) && styles.compoundCheckboxChecked
                ]}>
                  {isCompoundKnown(compound.word) && (
                    <Text style={styles.checkmark}>✓</Text>
                  )}
                </View>
              </View>
              {compound.meanings && compound.meanings.map((meaning, idx) => (
                <Text key={idx} style={styles.compoundMeaning}>
                  • {meaning}
                </Text>
              ))}
            </TouchableOpacity>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.lightGray,
  },
  characterSection: {
    backgroundColor: COLORS.white,
    padding: 30,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.primaryLight,
  },
  character: {
    fontSize: 120,
    fontWeight: 'bold',
    color: COLORS.textDark,
  },
  pinyin: {
    fontSize: 24,
    color: COLORS.primary,
    marginTop: 10,
    fontWeight: '600',
  },
  progressSection: {
    backgroundColor: COLORS.white,
    padding: 20,
    marginTop: 10,
    marginHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.primaryLight,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.textDark,
    marginBottom: 5,
  },
  sectionHint: {
    fontSize: 14,
    color: COLORS.textMedium,
    marginBottom: 15,
    fontStyle: 'italic',
  },
  progressBar: {
    height: 20,
    backgroundColor: COLORS.mediumGray,
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
    backgroundColor: COLORS.white,
    padding: 20,
    marginTop: 10,
    marginHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.primaryLight,
  },
  progressButton: {
    padding: 15,
    borderRadius: 8,
    marginVertical: 5,
    alignItems: 'center',
  },
  notStarted: {
    backgroundColor: COLORS.textLight,
  },
  learning: {
    backgroundColor: COLORS.primaryYellow,
  },
  mastered: {
    backgroundColor: COLORS.success,
  },
  buttonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },
  section: {
    backgroundColor: COLORS.white,
    padding: 20,
    marginTop: 10,
    marginBottom: 10,
    marginHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.primaryLight,
  },
  meaningText: {
    fontSize: 16,
    color: COLORS.textDark,
    marginVertical: 3,
    lineHeight: 24,
  },
  compoundItem: {
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
    paddingLeft: 15,
    paddingRight: 15,
    paddingVertical: 12,
    marginVertical: 8,
    backgroundColor: COLORS.lightGray,
    borderRadius: 8,
  },
  compoundHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  compoundInfo: {
    flex: 1,
  },
  compoundCheckbox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: COLORS.darkGray,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
  compoundCheckboxChecked: {
    backgroundColor: COLORS.success,
    borderColor: COLORS.success,
  },
  checkmark: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: 'bold',
  },
  compoundWord: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.textDark,
  },
  compoundTraditional: {
    fontSize: 18,
    color: COLORS.textMedium,
    marginTop: 2,
  },
  compoundPinyin: {
    fontSize: 16,
    color: COLORS.primary,
    marginTop: 4,
    fontWeight: '600',
  },
  compoundMeaning: {
    fontSize: 14,
    color: COLORS.textDark,
    marginTop: 6,
    lineHeight: 20,
  },
  editButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  editButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600',
  },
  addImageButton: {
    backgroundColor: COLORS.info,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 15,
    alignItems: 'center',
  },
  addImageButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 20,
    width: '100%',
    maxWidth: 500,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.textDark,
    marginBottom: 5,
  },
  modalHint: {
    fontSize: 14,
    color: COLORS.textMedium,
    marginBottom: 15,
  },
  modalTextInput: {
    borderWidth: 1,
    borderColor: COLORS.darkGray,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    minHeight: 200,
    textAlignVertical: 'top',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 20,
    gap: 10,
  },
  modalButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 80,
    alignItems: 'center',
  },
  modalButtonCancel: {
    backgroundColor: COLORS.lightGray,
  },
  modalButtonSave: {
    backgroundColor: COLORS.success,
  },
  modalButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textDark,
  },
});
