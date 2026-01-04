import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  Image,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import syncManager from '../services/syncManager';
import { COLORS } from '../theme/colors';
import api from '../services/api';

// Memoized compound word item component for better performance
const CompoundWordItem = React.memo(({ compound, customCompounds, isCompoundKnown, toggleCompoundKnown, handleEditCompoundMeanings, isAdmin }) => {
  const customCompoundData = customCompounds[compound.word];
  const displayMeanings = customCompoundData?.meanings || compound.meanings;
  const hasCustom = !!customCompoundData?.meanings;

  return (
    <View style={styles.compoundItem}>
      <TouchableOpacity onPress={() => toggleCompoundKnown(compound.word)}>
        <View style={styles.compoundHeader}>
          <View style={styles.compoundInfo}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={styles.compoundWord} selectable={true}>{compound.word}</Text>
              {hasCustom && (
                <Text style={styles.customLabel}>(Custom)</Text>
              )}
            </View>
            <Text style={styles.compoundTraditional} selectable={true}>
              {compound.traditional}
            </Text>
            <Text style={styles.compoundPinyin} selectable={true}>{compound.pinyin}</Text>
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
        {displayMeanings && displayMeanings.map((meaning, idx) => (
          <Text key={idx} style={styles.compoundMeaning} selectable={true}>
            • {meaning}
          </Text>
        ))}
      </TouchableOpacity>
      {isAdmin && (
        <TouchableOpacity
          onPress={() => handleEditCompoundMeanings(compound)}
          style={styles.editCompoundButton}
        >
          <Text style={styles.editCompoundButtonText}>✏️ Edit</Text>
        </TouchableOpacity>
      )}
    </View>
  );
});

const CharacterDetailScreen = React.memo(({ route, navigation, isAdmin }) => {
  const { character } = route.params;
  const [charProgress, setCharProgress] = useState(0);
  const [compoundKnownList, setCompoundKnownList] = useState({});
  const [customMeanings, setCustomMeanings] = useState(null);
  const [customCompounds, setCustomCompounds] = useState({});
  const [customImage, setCustomImage] = useState(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editedMeanings, setEditedMeanings] = useState('');
  const [editingCompound, setEditingCompound] = useState(null);
  const [sentences, setSentences] = useState([]);
  const [sentencesExpanded, setSentencesExpanded] = useState(false);
  const [loadingSentences, setLoadingSentences] = useState(false);

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
      // Load custom meanings from AsyncStorage
      const customData = await AsyncStorage.getItem('@customCharacterData');
      if (customData) {
        const parsed = JSON.parse(customData);
        const charData = parsed[character.char];
        if (charData) {
          setCustomMeanings(charData.meanings);
          setCustomCompounds(charData.compounds || {});
        }
      }

      // Load image from server
      try {
        const imageUrl = api.getCharacterImageUrl(character.char);
        // Test if image exists by trying to fetch it
        const response = await fetch(imageUrl);
        if (response.ok) {
          setCustomImage(imageUrl);
        }
      } catch (error) {
        console.log('[DETAIL] No custom image for', character.char);
      }
    } catch (error) {
      console.error('[DETAIL] Error loading custom data:', error);
    }
  };

  const loadSentences = async () => {
    if (sentences.length > 0) return; // Already loaded

    try {
      setLoadingSentences(true);

      // Try to load from cache first
      const cacheKey = `@sentences_${character.char}`;
      const cached = await AsyncStorage.getItem(cacheKey);

      if (cached) {
        const cachedSentences = JSON.parse(cached);
        console.log('[DETAIL] Loaded sentences from cache');
        setSentences(cachedSentences);
        setLoadingSentences(false);
        return;
      }

      // If not cached, fetch from API
      const data = await api.getSentences(character.char);

      if (data.success && data.senses) {
        // Flatten sentences from all senses
        const allSentences = [];
        data.senses.forEach(sense => {
          if (sense.sentences && sense.sentences.length > 0) {
            sense.sentences.forEach(sentence => {
              allSentences.push({
                ...sentence,
                senseId: sense.senseId,
                senseMeaning: sense.meaning,
                mastery: sense.mastery || 0,
              });
            });
          }
        });

        // Cache the sentences
        await AsyncStorage.setItem(cacheKey, JSON.stringify(allSentences));
        console.log('[DETAIL] Cached sentences for', character.char);

        setSentences(allSentences);
      }
    } catch (error) {
      console.log('[DETAIL] Could not load sentences:', error.message);
      // Silently fail - sentences are optional
    } finally {
      setLoadingSentences(false);
    }
  };

  const toggleSentences = useCallback(() => {
    if (!sentencesExpanded && sentences.length === 0) {
      loadSentences();
    }
    setSentencesExpanded(!sentencesExpanded);
  }, [sentencesExpanded, sentences.length]);

  const handleEditMeanings = useCallback(() => {
    const currentMeanings = customMeanings || character.meanings || [];
    setEditedMeanings(currentMeanings.join('\n'));
    setEditModalVisible(true);
  }, [customMeanings, character.meanings]);

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

  const handleAddImage = async () => {
    try {
      // Request permission
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please grant permission to access your photos');
        return;
      }

      // Pick image from gallery
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images',
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.7, // Compress to 70% quality
      });

      if (result.canceled) {
        return;
      }

      setUploadingImage(true);

      // Upload to server
      const imageUri = result.assets[0].uri;
      await api.uploadCharacterImage(character.char, imageUri);

      // Reload image from server
      const imageUrl = api.getCharacterImageUrl(character.char);
      setCustomImage(imageUrl + '?t=' + Date.now()); // Add timestamp to bypass cache

      Alert.alert('Success', 'Image uploaded successfully!');
    } catch (error) {
      console.error('[DETAIL] Error uploading image:', error);
      Alert.alert('Upload Failed', error.message || 'Could not upload image');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleEditCompound = (compound) => {
    const customMeanings = customCompounds[compound.word]?.meanings;
    const currentMeanings = customMeanings || compound.meanings || [];
    setEditedMeanings(currentMeanings.join('\n'));
    setEditingCompound(compound);
    setEditModalVisible(true);
  };

  const handleSaveCompoundMeanings = async () => {
    try {
      const newMeanings = editedMeanings.split('\n').filter(m => m.trim());

      // Save to AsyncStorage
      const customData = await AsyncStorage.getItem('@customCharacterData');
      const parsed = customData ? JSON.parse(customData) : {};

      if (!parsed[character.char]) {
        parsed[character.char] = {};
      }
      if (!parsed[character.char].compounds) {
        parsed[character.char].compounds = {};
      }
      parsed[character.char].compounds[editingCompound.word] = {
        meanings: newMeanings
      };

      await AsyncStorage.setItem('@customCharacterData', JSON.stringify(parsed));

      // Update local state
      setCustomCompounds(prev => ({
        ...prev,
        [editingCompound.word]: { meanings: newMeanings }
      }));

      setEditModalVisible(false);
      setEditingCompound(null);

      // TODO: Sync to server
      Alert.alert('Success', 'Compound meanings updated successfully');
    } catch (error) {
      console.error('[DETAIL] Error saving compound meanings:', error);
      Alert.alert('Error', 'Failed to save compound meanings');
    }
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
        <Text style={styles.character} selectable={true}>{character.char}</Text>
        <Text style={styles.pinyin} selectable={true}>{character.pinyin}</Text>

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
              <Text key={index} style={[styles.meaningText, { fontSize: 16, color: COLORS.textMedium }]} selectable={true}>
                • {meaning}
              </Text>
            ))
          ) : (
            <Text style={{ fontSize: 14, color: COLORS.error }}>No meanings available</Text>
          )}
          {customImage && (
            <View style={styles.imageContainer}>
              <Image
                source={{ uri: customImage }}
                style={styles.characterImage}
                resizeMode="contain"
              />
            </View>
          )}
          {isAdmin && (
            <TouchableOpacity
              onPress={handleAddImage}
              style={styles.addImageButton}
              disabled={uploadingImage}
            >
              {uploadingImage ? (
                <ActivityIndicator color={COLORS.white} />
              ) : (
                <Text style={styles.addImageButtonText}>
                  📷 {customImage ? 'Change' : 'Add'} Memory Image
                </Text>
              )}
            </TouchableOpacity>
          )}

          {/* Example Sentences Section */}
          <TouchableOpacity
            style={styles.sentencesCollapsibleHeader}
            onPress={toggleSentences}
          >
            <View>
              <Text style={styles.sentencesHeaderTitle}>📚 Example Sentences</Text>
              <Text style={styles.sentencesHeaderSubtitle}>
                {loadingSentences ? 'Loading...' :
                 sentences.length > 0 ? `${sentences.length} sentences available • Tap to ${sentencesExpanded ? 'collapse' : 'expand'}` :
                 'Tap to load sentences'}
              </Text>
            </View>
            <Text style={[styles.sentencesArrow, sentencesExpanded && styles.sentencesArrowOpen]}>
              ▶
            </Text>
          </TouchableOpacity>

          {sentencesExpanded && sentences.length > 0 && (
            <View style={styles.sentencesContainer}>
              {sentences.map((sentence, index) => (
                <View key={index} style={styles.sentenceCard}>
                  <View style={styles.sentenceHeader}>
                    <View style={styles.senseBadge}>
                      <Text style={styles.senseBadgeText}>{sentence.senseMeaning}</Text>
                    </View>
                  </View>
                  <Text style={styles.sentenceChinese}>
                    {sentence.chinese}
                  </Text>
                  {sentence.pinyin && (
                    <Text style={styles.sentencePinyin}>{sentence.pinyin}</Text>
                  )}
                  <Text style={styles.sentenceEnglish}>{sentence.english}</Text>
                </View>
              ))}

              <TouchableOpacity
                onPress={() => navigation.navigate('SentencePractice', {
                  character: character.char,
                  pinyin: character.pinyin
                })}
                style={styles.sentencesPracticeButton}
              >
                <Text style={styles.sentencesPracticeButtonText}>📝 Practice with These Sentences</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>

      {/* Edit Meanings Modal */}
      <Modal
        visible={editModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setEditModalVisible(false);
          setEditingCompound(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              Edit Meanings for {editingCompound ? editingCompound.word : character.char}
            </Text>
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
                onPress={() => {
                  setEditModalVisible(false);
                  setEditingCompound(null);
                }}
              >
                <Text style={styles.modalButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonSave]}
                onPress={editingCompound ? handleSaveCompoundMeanings : handleSaveMeanings}
              >
                <Text style={[styles.modalButtonText, { color: COLORS.white }]}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Compounds - Virtualized List */}
      {character.compounds && character.compounds.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Compound Words</Text>
          <Text style={styles.sectionHint}>Tap a word to add it to your quiz list</Text>
          <FlatList
            data={character.compounds}
            renderItem={({ item }) => (
              <CompoundWordItem
                compound={item}
                customCompounds={customCompounds}
                isCompoundKnown={isCompoundKnown}
                toggleCompoundKnown={toggleCompoundKnown}
                handleEditCompoundMeanings={handleEditCompound}
                isAdmin={isAdmin}
              />
            )}
            keyExtractor={(item, index) => `${item.word}-${index}`}
            initialNumToRender={20}
            maxToRenderPerBatch={10}
            windowSize={5}
            removeClippedSubviews={true}
            scrollEnabled={false}
            nestedScrollEnabled={false}
          />
        </View>
      )}
    </ScrollView>
  );
});

export default CharacterDetailScreen;

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
  imageContainer: {
    marginTop: 15,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: COLORS.lightGray,
  },
  characterImage: {
    width: '100%',
    height: 200,
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
  sentencesButton: {
    backgroundColor: COLORS.primaryYellow,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 15,
    alignItems: 'center',
  },
  sentencesButtonText: {
    color: COLORS.textDark,
    fontSize: 15,
    fontWeight: '600',
  },
  sentencesCollapsibleHeader: {
    backgroundColor: COLORS.white,
    padding: 16,
    borderRadius: 12,
    marginTop: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: COLORS.textDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  sentencesHeaderTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textDark,
    marginBottom: 4,
  },
  sentencesHeaderSubtitle: {
    fontSize: 13,
    color: COLORS.textMedium,
  },
  sentencesArrow: {
    fontSize: 16,
    color: COLORS.textMedium,
    transform: [{ rotate: '0deg' }],
  },
  sentencesArrowOpen: {
    transform: [{ rotate: '90deg' }],
  },
  sentencesContainer: {
    marginTop: 12,
  },
  sentenceCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.primary,
    shadowColor: COLORS.textDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  sentenceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lightGray,
  },
  senseBadge: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  senseBadgeText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: '600',
  },
  sentenceChinese: {
    fontSize: 18,
    color: COLORS.textDark,
    marginBottom: 8,
    lineHeight: 28,
    fontWeight: '500',
  },
  sentencePinyin: {
    fontSize: 14,
    color: COLORS.primary,
    marginBottom: 8,
    fontStyle: 'italic',
  },
  sentenceEnglish: {
    fontSize: 15,
    color: COLORS.textMedium,
    lineHeight: 22,
  },
  sentencesPracticeButton: {
    backgroundColor: COLORS.primaryYellow,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 8,
    alignItems: 'center',
    shadowColor: COLORS.primaryYellow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  sentencesPracticeButtonText: {
    color: COLORS.textDark,
    fontSize: 16,
    fontWeight: '700',
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
  editCompoundButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    marginTop: 10,
    alignSelf: 'flex-start',
  },
  editCompoundButtonText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '600',
  },
  customLabel: {
    fontSize: 12,
    color: COLORS.primary,
    fontStyle: 'italic',
  },
});
