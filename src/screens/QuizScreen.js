import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '../services/api';

export default function QuizScreen() {
  const [quizMode, setQuizMode] = useState(null); // null | 'words' | 'sentences'
  const [quiz, setQuiz] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const [characters, setCharacters] = useState({});

  useEffect(() => {
    loadCharacters();
  }, []);

  const loadCharacters = async () => {
    try {
      const charData = require('../data/characters.json');
      setCharacters(charData);
    } catch (error) {
      console.error('[QUIZ] Error loading characters:', error);
    }
  };

  const startWordQuiz = async () => {
    try {
      // Try to get fresh progress from server first
      let progressData = null;
      try {
        const result = await api.getProgress();
        console.log('[QUIZ] Server response:', result);
        if (result.success) {
          progressData = result.progress;
          await AsyncStorage.setItem('@progress', JSON.stringify(progressData));
        }
      } catch (error) {
        console.log('[QUIZ] Server error:', error.message);
        const cachedProgress = await AsyncStorage.getItem('@progress');
        if (cachedProgress) {
          progressData = JSON.parse(cachedProgress);
          console.log('[QUIZ] Using cached progress');
        }
      }

      // Initialize empty progress if none exists
      if (!progressData) {
        progressData = { characterProgress: {}, compoundProgress: {} };
        await AsyncStorage.setItem('@progress', JSON.stringify(progressData));
        console.log('[QUIZ] Initialized empty progress');
      }

      console.log('[QUIZ] Progress data keys:', Object.keys(progressData));

      const knownWords = [];

      // Collect all compound words from characters with any progress
      Object.keys(characters).forEach(char => {
        const charProgress = progressData.characterProgress?.[char];
        // Include if character has any progress data (not just "known")
        if (charProgress) {
          const charData = characters[char];
          if (charData.compounds) {
            charData.compounds.forEach(compound => {
              knownWords.push({
                word: compound.word,
                pinyin: compound.pinyin,
                meanings: compound.meanings,
                char: char,
              });
            });
          }
        }
      });

      // Also check compound progress directly
      if (progressData.compoundProgress) {
        Object.keys(progressData.compoundProgress).forEach(word => {
          const compoundData = progressData.compoundProgress[word];
          if (compoundData) {
            // Find this compound in characters data
            Object.keys(characters).forEach(char => {
              const charData = characters[char];
              if (charData.compounds) {
                const found = charData.compounds.find(c => c.word === word);
                if (found && !knownWords.find(w => w.word === word)) {
                  knownWords.push({
                    word: found.word,
                    pinyin: found.pinyin,
                    meanings: found.meanings,
                    char: char,
                  });
                }
              }
            });
          }
        });
      }

      console.log('[QUIZ] Progress data structure:', {
        hasCharacterProgress: !!progressData.characterProgress,
        characterProgressKeys: progressData.characterProgress ? Object.keys(progressData.characterProgress).length : 0,
        hasCompoundProgress: !!progressData.compoundProgress,
        compoundProgressKeys: progressData.compoundProgress ? Object.keys(progressData.compoundProgress).length : 0,
        sampleCharProgress: progressData.characterProgress ? Object.entries(progressData.characterProgress).slice(0, 2) : [],
        sampleCompoundProgress: progressData.compoundProgress ? Object.entries(progressData.compoundProgress).slice(0, 2) : []
      });
      console.log('[QUIZ] Found', knownWords.length, 'compound words from progress');

      if (knownWords.length === 0) {
        Alert.alert(
          'No Words Yet',
          'No compound words found in your progress. Long-press characters on the Home screen to mark them as known, which will unlock their compound words for quizzing!'
        );
        return;
      }

      // Shuffle and take up to 10 words
      const shuffled = knownWords.sort(() => 0.5 - Math.random());
      const quizItems = shuffled.slice(0, Math.min(10, shuffled.length));

      setQuiz(quizItems);
      setQuizMode('words');
      setCurrentIndex(0);
      setRevealed(false);
      setScore({ correct: 0, total: 0 });
    } catch (error) {
      console.error('[QUIZ] Error starting quiz:', error);
      Alert.alert('Error', 'Could not start quiz: ' + error.message);
    }
  };

  const revealAnswer = () => {
    setRevealed(true);
  };

  const markAnswer = async (isCorrect) => {
    const newScore = {
      correct: score.correct + (isCorrect ? 1 : 0),
      total: score.total + 1,
    };
    setScore(newScore);

    // Save quiz result for this word locally
    try {
      const currentWord = quiz[currentIndex].word;
      const cachedProgress = await AsyncStorage.getItem('@progress');
      const progressData = cachedProgress ? JSON.parse(cachedProgress) : { characterProgress: {}, compoundProgress: {} };

      if (!progressData.compoundProgress) {
        progressData.compoundProgress = {};
      }

      if (!progressData.compoundProgress[currentWord]) {
        progressData.compoundProgress[currentWord] = { attempts: 0, correct: 0 };
      }

      progressData.compoundProgress[currentWord].attempts += 1;
      if (isCorrect) {
        progressData.compoundProgress[currentWord].correct += 1;
      }
      progressData.compoundProgress[currentWord].lastQuizzed = Date.now();

      await AsyncStorage.setItem('@progress', JSON.stringify(progressData));
      console.log('[QUIZ] Saved result for', currentWord, '- correct:', isCorrect);
    } catch (error) {
      console.error('[QUIZ] Error saving quiz result:', error);
    }

    // Move to next question or finish
    if (currentIndex < quiz.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setRevealed(false);
    } else {
      // Quiz complete
      const finalScore = newScore.correct;
      const finalTotal = newScore.total;
      const percentage = Math.round((finalScore / finalTotal) * 100);

      // Save quiz session
      try {
        const session = {
          date: Date.now(),
          score: finalScore,
          total: finalTotal,
          percentage: percentage,
        };

        const cachedProgress = await AsyncStorage.getItem('@progress');
        const progressData = cachedProgress ? JSON.parse(cachedProgress) : { characterProgress: {}, compoundProgress: {} };

        if (!progressData.quizSessions) {
          progressData.quizSessions = [];
        }
        progressData.quizSessions.push(session);

        await AsyncStorage.setItem('@progress', JSON.stringify(progressData));
        console.log('[QUIZ] Saved quiz session:', session);
      } catch (error) {
        console.error('[QUIZ] Error saving quiz session:', error);
      }

      Alert.alert(
        'Quiz Complete! 🎉',
        `You got ${finalScore} out of ${finalTotal} correct (${percentage}%)`,
        [
          { text: 'Try Again', onPress: () => startWordQuiz() },
          { text: 'Done', onPress: () => setQuizMode(null) },
        ]
      );
    }
  };

  const quitQuiz = () => {
    Alert.alert(
      'Quit Quiz?',
      'Your progress will not be saved.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Quit', onPress: () => setQuizMode(null), style: 'destructive' },
      ]
    );
  };

  // Quiz mode selection
  if (!quizMode) {
    return (
      <ScrollView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>🎯 Quiz</Text>
          <Text style={styles.subtitle}>Test your knowledge</Text>
        </View>

        <View style={styles.modeContainer}>
          <TouchableOpacity
            style={styles.modeButton}
            onPress={startWordQuiz}
          >
            <Text style={styles.modeIcon}>📝</Text>
            <Text style={styles.modeTitle}>Word Quiz</Text>
            <Text style={styles.modeDesc}>Test compound word meanings</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.modeButton, styles.modeButtonDisabled]}
            onPress={() => Alert.alert('Coming Soon', 'Sentence quiz will be available soon!')}
          >
            <Text style={styles.modeIcon}>💬</Text>
            <Text style={styles.modeTitle}>Sentence Quiz</Text>
            <Text style={styles.modeDesc}>Coming soon...</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.statsContainer}>
          <Text style={styles.statsTitle}>Quiz Tips:</Text>
          <Text style={styles.statsTip}>• Long-press characters in the Home tab to mark them as known</Text>
          <Text style={styles.statsTip}>• Known characters unlock compound word quizzes</Text>
          <Text style={styles.statsTip}>• Quiz yourself regularly for better retention</Text>
        </View>
      </ScrollView>
    );
  }

  // Active quiz
  if (!quiz || quiz.length === 0) {
    return (
      <View style={styles.container}>
        <Text>Loading quiz...</Text>
      </View>
    );
  }

  const currentItem = quiz[currentIndex];

  return (
    <View style={styles.container}>
      {/* Quiz Header */}
      <View style={styles.quizHeader}>
        <Text style={styles.quizProgress}>
          Question {currentIndex + 1}/{quiz.length}
        </Text>
        <TouchableOpacity onPress={quitQuiz}>
          <Text style={styles.quitButton}>✕ Quit</Text>
        </TouchableOpacity>
      </View>

      {/* Quiz Score */}
      <View style={styles.scoreContainer}>
        <Text style={styles.scoreText}>
          Score: {score.correct}/{score.total}
        </Text>
      </View>

      {/* Quiz Card */}
      <View style={styles.quizCard}>
        <Text style={styles.quizWord}>{currentItem.word}</Text>
        <Text style={styles.quizPinyin}>{currentItem.pinyin}</Text>

        {revealed && (
          <View style={styles.meaningContainer}>
            <Text style={styles.meaningLabel}>Meaning:</Text>
            {currentItem.meanings.map((meaning, idx) => (
              <Text key={idx} style={styles.quizMeaning}>
                • {meaning}
              </Text>
            ))}
          </View>
        )}
      </View>

      {/* Quiz Actions */}
      <View style={styles.quizActions}>
        {!revealed ? (
          <TouchableOpacity
            style={[styles.quizButton, styles.revealButton]}
            onPress={revealAnswer}
          >
            <Text style={styles.quizButtonText}>👁️ Reveal Answer</Text>
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity
              style={[styles.quizButton, styles.wrongButton]}
              onPress={() => markAnswer(false)}
            >
              <Text style={styles.quizButtonText}>❌ Wrong</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.quizButton, styles.correctButton]}
              onPress={() => markAnswer(true)}
            >
              <Text style={styles.quizButtonText}>✓ Correct</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#667eea',
    padding: 30,
    alignItems: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#fff',
    opacity: 0.9,
  },
  modeContainer: {
    padding: 20,
  },
  modeButton: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 24,
    marginBottom: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  modeButtonDisabled: {
    opacity: 0.6,
  },
  modeIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  modeTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  modeDesc: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  statsContainer: {
    backgroundColor: '#fff',
    margin: 20,
    padding: 20,
    borderRadius: 12,
  },
  statsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  statsTip: {
    fontSize: 14,
    color: '#666',
    marginVertical: 4,
    lineHeight: 20,
  },
  quizHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#667eea',
  },
  quizProgress: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '600',
  },
  quitButton: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '600',
  },
  scoreContainer: {
    padding: 16,
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  scoreText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#667eea',
  },
  quizCard: {
    backgroundColor: '#fff',
    margin: 20,
    padding: 30,
    borderRadius: 12,
    alignItems: 'center',
    minHeight: 250,
    justifyContent: 'center',
  },
  quizWord: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  quizPinyin: {
    fontSize: 20,
    color: '#667eea',
    marginBottom: 20,
  },
  meaningContainer: {
    width: '100%',
    marginTop: 20,
    padding: 16,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
  },
  meaningLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#666',
    marginBottom: 8,
  },
  quizMeaning: {
    fontSize: 16,
    color: '#333',
    marginVertical: 4,
  },
  quizActions: {
    flexDirection: 'row',
    padding: 20,
    gap: 12,
  },
  quizButton: {
    flex: 1,
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  revealButton: {
    backgroundColor: '#667eea',
  },
  correctButton: {
    backgroundColor: '#4caf50',
  },
  wrongButton: {
    backgroundColor: '#f44336',
  },
  quizButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
