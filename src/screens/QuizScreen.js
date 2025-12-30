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
import {
  calculateNextReview,
  getQuizDirection,
  prioritizeQuizItems,
  getQualityLabel,
} from '../services/sm2Algorithm';

// Update streak function (ported from website)
function updateStreak(progressData) {
  const today = new Date().toISOString().split('T')[0];
  const hasActivityToday = progressData.statistics.dailyStats[today] != null;

  if (!hasActivityToday) {
    return;
  }

  // Calculate current streak by counting backwards from today
  let streak = 0;
  let checkDate = new Date();

  while (true) {
    const dateStr = checkDate.toISOString().split('T')[0];
    if (progressData.statistics.dailyStats[dateStr]) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }

  progressData.statistics.milestones.currentStreak = streak;

  // Update longest streak
  if (streak > (progressData.statistics.milestones.longestStreak || 0)) {
    progressData.statistics.milestones.longestStreak = streak;
  }
}

export default function QuizScreen() {
  const [quizMode, setQuizMode] = useState(null); // null | 'words' | 'sentences'
  const [quiz, setQuiz] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const [characters, setCharacters] = useState({});
  const [quizStartTime, setQuizStartTime] = useState(null); // Track time for quality suggestion

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
        // Server returns progress object directly, not wrapped in {success: true, progress: {...}}
        if (result && typeof result === 'object') {
          progressData = result;
          await AsyncStorage.setItem('@progress', JSON.stringify(progressData));
          console.log('[QUIZ] Loaded progress from server');
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
        progressData = { characterProgress: {}, compoundProgress: {}, statistics: null };
        await AsyncStorage.setItem('@progress', JSON.stringify(progressData));
        console.log('[QUIZ] Initialized empty progress');
      }

      // Initialize statistics structure if missing
      if (!progressData.statistics) {
        progressData.statistics = {
          quizSessions: [],
          dailyStats: {},
          milestones: {
            totalSessions: 0,
            totalReviews: 0,
            currentStreak: 0,
            longestStreak: 0,
            firstQuizDate: null,
          },
          currentSession: null,
        };
      }

      console.log('[QUIZ] Progress data keys:', Object.keys(progressData));

      const quizItems = [];

      // Add individual characters marked as known
      if (progressData.characterProgress) {
        Object.keys(progressData.characterProgress).forEach(char => {
          const charData = progressData.characterProgress[char];
          if (charData && charData.known && characters[char]) {
            quizItems.push({
              type: 'character',
              word: char,
              pinyin: characters[char].pinyin,
              meanings: characters[char].meanings,
              char: char,
              quizData: charData.quizScore || null, // Include quiz data for SM-2
            });
          }
        });
      }

      // Add compound words that were explicitly marked as known
      // Website format: compoundProgress[char].known = [word1, word2]
      if (progressData.compoundProgress) {
        Object.keys(progressData.compoundProgress).forEach(char => {
          const charProgress = progressData.compoundProgress[char];
          if (charProgress && charProgress.known && Array.isArray(charProgress.known)) {
            const charData = characters[char];
            if (charData && charData.compounds) {
              charProgress.known.forEach(word => {
                const found = charData.compounds.find(c => c.word === word);
                if (found && !quizItems.find(w => w.word === word)) {
                  quizItems.push({
                    type: 'compound',
                    word: found.word,
                    pinyin: found.pinyin,
                    meanings: found.meanings,
                    char: char,
                    quizData: charProgress.quizScores?.[word] || null, // Include quiz data for SM-2
                  });
                }
              });
            }
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
      console.log('[QUIZ] Found', quizItems.length, 'items for quiz (characters + compounds)');

      if (quizItems.length === 0) {
        Alert.alert(
          'No Items Yet',
          'No characters or words found in your progress. Long-press characters on the Home screen to mark them as known, or tap compound words in the character detail screen!'
        );
        return;
      }

      // Use SM-2 prioritization: due items first, then struggling, then new, then mastered
      const prioritized = prioritizeQuizItems(quizItems);
      const selectedItems = prioritized.slice(0, Math.min(10, prioritized.length));

      console.log('[QUIZ] Prioritized quiz items:', selectedItems.map(item => ({
        word: item.word,
        priority: item.priority,
        score: item.quizData?.score,
        nextReview: item.quizData?.nextReview ? new Date(item.quizData.nextReview).toLocaleDateString() : 'never'
      })));

      // Initialize quiz session tracking (matching website structure)
      progressData.statistics.currentSession = {
        startTime: Date.now(),
        endTime: null,
        mode: 'words',
        totalItems: selectedItems.length,
        correctCount: 0,
        accuracy: 0,
        duration: 0,
      };
      await AsyncStorage.setItem('@progress', JSON.stringify(progressData));

      setQuiz(selectedItems);
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
    setQuizStartTime(Date.now()); // Start timing from reveal (for quality suggestion)
  };

  const markQuality = async (quality) => {
    // Quality >= 3 is considered "correct"
    const isCorrect = quality >= 3;
    const newScore = {
      correct: score.correct + (isCorrect ? 1 : 0),
      total: score.total + 1,
    };
    setScore(newScore);

    // Save quiz result locally
    try {
      const currentItem = quiz[currentIndex];
      const currentWord = currentItem.word;
      const itemType = currentItem.type; // 'character' or 'compound'

      const cachedProgress = await AsyncStorage.getItem('@progress');
      const progressData = cachedProgress ? JSON.parse(cachedProgress) : { characterProgress: {}, compoundProgress: {} };

      // Initialize progress objects if needed
      if (!progressData.compoundProgress) {
        progressData.compoundProgress = {};
      }
      if (!progressData.characterProgress) {
        progressData.characterProgress = {};
      }

      // Track progress based on item type using SM-2 algorithm
      if (itemType === 'character') {
        if (!progressData.characterProgress[currentWord]) {
          progressData.characterProgress[currentWord] = { known: true };
        }
        if (!progressData.characterProgress[currentWord].quizScore) {
          progressData.characterProgress[currentWord].quizScore = null;
        }

        // Use SM-2 algorithm to calculate next review
        const updatedQuizData = calculateNextReview(
          progressData.characterProgress[currentWord].quizScore,
          quality
        );
        progressData.characterProgress[currentWord].quizScore = updatedQuizData;
      } else {
        // Compound word - use website format: compoundProgress[char].quizScores[word]
        const char = currentItem.char;
        if (!progressData.compoundProgress[char]) {
          progressData.compoundProgress[char] = { known: [], total: 0, quizScores: {} };
        }
        if (!progressData.compoundProgress[char].quizScores) {
          progressData.compoundProgress[char].quizScores = {};
        }
        if (!progressData.compoundProgress[char].quizScores[currentWord]) {
          progressData.compoundProgress[char].quizScores[currentWord] = null;
        }

        // Use SM-2 algorithm to calculate next review
        const updatedQuizData = calculateNextReview(
          progressData.compoundProgress[char].quizScores[currentWord],
          quality
        );
        progressData.compoundProgress[char].quizScores[currentWord] = updatedQuizData;
      }

      await AsyncStorage.setItem('@progress', JSON.stringify(progressData));
      console.log('[QUIZ] Saved result for', currentWord, `(${itemType})`, '- correct:', isCorrect);
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

      // Save quiz session (matching website structure)
      try {
        const cachedProgress = await AsyncStorage.getItem('@progress');
        const progressData = cachedProgress ? JSON.parse(cachedProgress) : {
          characterProgress: {},
          compoundProgress: {},
          statistics: {
            quizSessions: [],
            dailyStats: {},
            milestones: {
              totalSessions: 0,
              totalReviews: 0,
              currentStreak: 0,
              longestStreak: 0,
              firstQuizDate: null,
            },
            currentSession: null,
          }
        };

        // Complete the current session
        if (progressData.statistics.currentSession) {
          const session = progressData.statistics.currentSession;
          session.endTime = Date.now();
          session.duration = session.endTime - session.startTime;
          session.correctCount = finalScore;
          session.accuracy = finalScore / finalTotal;

          // Add to session history
          progressData.statistics.quizSessions.push(session);

          // Update daily stats
          const dateStr = new Date().toISOString().split('T')[0];
          if (!progressData.statistics.dailyStats[dateStr]) {
            progressData.statistics.dailyStats[dateStr] = {
              sessionsCount: 0,
              itemsReviewed: 0,
              newWordsLearned: 0,
              accuracy: 0,
              timeSpent: 0,
            };
          }

          const dayStats = progressData.statistics.dailyStats[dateStr];
          dayStats.sessionsCount++;
          dayStats.itemsReviewed += finalTotal;
          dayStats.timeSpent += session.duration;

          // Update accuracy (weighted average)
          const totalReviews = dayStats.itemsReviewed;
          dayStats.accuracy =
            ((dayStats.accuracy * (totalReviews - finalTotal)) +
              (session.accuracy * finalTotal)) /
            totalReviews;

          // Update milestones
          progressData.statistics.milestones.totalSessions++;
          progressData.statistics.milestones.totalReviews += finalTotal;

          if (!progressData.statistics.milestones.firstQuizDate) {
            progressData.statistics.milestones.firstQuizDate = Date.now();
          }

          // Update streak
          updateStreak(progressData);

          // Clear current session
          progressData.statistics.currentSession = null;
        }

        await AsyncStorage.setItem('@progress', JSON.stringify(progressData));
        console.log('[QUIZ] Saved quiz session with statistics');
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
      {!revealed ? (
        <TouchableOpacity
          style={[styles.quizButton, styles.revealButton]}
          onPress={revealAnswer}
        >
          <Text style={styles.quizButtonText}>👁️ Reveal Answer</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.qualityRatingContainer}>
          <Text style={styles.qualityLabel}>How well did you know it?</Text>
          <View style={styles.qualityButtons}>
            {/* Failed - Quality 0-2 */}
            <TouchableOpacity
              style={[styles.qualityButton, styles.quality0]}
              onPress={() => markQuality(0)}
            >
              <Text style={styles.qualityButtonText}>😵</Text>
              <Text style={styles.qualityButtonLabel}>Forgot</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.qualityButton, styles.quality1]}
              onPress={() => markQuality(1)}
            >
              <Text style={styles.qualityButtonText}>😓</Text>
              <Text style={styles.qualityButtonLabel}>Very Hard</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.qualityButton, styles.quality2]}
              onPress={() => markQuality(2)}
            >
              <Text style={styles.qualityButtonText}>😕</Text>
              <Text style={styles.qualityButtonLabel}>Hard</Text>
            </TouchableOpacity>

            {/* Passed - Quality 3-5 */}
            <TouchableOpacity
              style={[styles.qualityButton, styles.quality3]}
              onPress={() => markQuality(3)}
            >
              <Text style={styles.qualityButtonText}>😐</Text>
              <Text style={styles.qualityButtonLabel}>Okay</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.qualityButton, styles.quality4]}
              onPress={() => markQuality(4)}
            >
              <Text style={styles.qualityButtonText}>🙂</Text>
              <Text style={styles.qualityButtonLabel}>Good</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.qualityButton, styles.quality5]}
              onPress={() => markQuality(5)}
            >
              <Text style={styles.qualityButtonText}>😄</Text>
              <Text style={styles.qualityButtonLabel}>Perfect!</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
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
  qualityRatingContainer: {
    padding: 20,
    backgroundColor: '#fff',
    margin: 20,
    marginTop: 0,
    borderRadius: 12,
  },
  qualityLabel: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
    marginBottom: 16,
  },
  qualityButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
  },
  qualityButton: {
    width: '30%',
    minWidth: 100,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#e0e0e0',
  },
  qualityButtonText: {
    fontSize: 32,
    marginBottom: 4,
  },
  qualityButtonLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
  },
  quality0: {
    backgroundColor: '#ffebee',
    borderColor: '#f44336',
  },
  quality1: {
    backgroundColor: '#fff3e0',
    borderColor: '#ff9800',
  },
  quality2: {
    backgroundColor: '#fff9e0',
    borderColor: '#ffc107',
  },
  quality3: {
    backgroundColor: '#e3f2fd',
    borderColor: '#2196F3',
  },
  quality4: {
    backgroundColor: '#e8f5e9',
    borderColor: '#4caf50',
  },
  quality5: {
    backgroundColor: '#e8f5e9',
    borderColor: '#4caf50',
  },
});
