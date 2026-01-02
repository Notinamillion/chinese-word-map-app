import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Animated,
  Vibration,
  Image,
  ToastAndroid,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Speech from 'expo-speech';
import api from '../services/api';
import syncManager from '../services/syncManager';
import COLORS from '../theme/colors';
import {
  calculateNextReview,
  getQuizDirection,
  prioritizeQuizItems,
  getQualityLabel,
  formatNextReview,
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

// Save session statistics (called periodically and on quit)
async function saveSessionStatistics(currentScore, isComplete = false) {
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
        lastSavedQuestionCount: 0, // Track how many questions we've already counted
      }
    };

    if (!progressData.statistics.currentSession) {
      console.log('[QUIZ] No current session to save');
      return;
    }

    const session = progressData.statistics.currentSession;
    const now = Date.now();

    // Calculate NEW questions since last save (not total)
    const lastSavedCount = progressData.statistics.lastSavedQuestionCount || 0;
    const newQuestions = currentScore.total - lastSavedCount;

    console.log('[QUIZ] 📊 Stats calculation:', {
      totalQuestions: currentScore.total,
      lastSaved: lastSavedCount,
      newQuestions: newQuestions,
      isComplete
    });

    // Update session with current stats
    session.endTime = now;
    session.duration = now - session.startTime;
    session.correctCount = currentScore.correct;
    session.totalItems = currentScore.total;
    session.accuracy = currentScore.total > 0 ? currentScore.correct / currentScore.total : 0;

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

    // If this is completion, increment session count
    if (isComplete) {
      dayStats.sessionsCount++;
    }

    // ONLY add the NEW questions (not the total)
    dayStats.itemsReviewed = (dayStats.itemsReviewed || 0) + newQuestions;
    dayStats.timeSpent = (dayStats.timeSpent || 0) + session.duration;

    // Update accuracy (weighted average based on NEW questions)
    if (newQuestions > 0) {
      const previousTotal = (dayStats.itemsReviewed || 0) - newQuestions;
      const totalReviews = dayStats.itemsReviewed;
      dayStats.accuracy =
        ((dayStats.accuracy * previousTotal) +
          (session.accuracy * newQuestions)) /
        totalReviews;
    }

    // Update milestones (only add new questions)
    progressData.statistics.milestones.totalReviews =
      (progressData.statistics.milestones.totalReviews || 0) + newQuestions;

    if (isComplete) {
      progressData.statistics.milestones.totalSessions++;

      // Add to session history only on complete
      progressData.statistics.quizSessions.push({ ...session });

      // Clear current session
      progressData.statistics.currentSession = null;
      progressData.statistics.lastSavedQuestionCount = 0;
    } else {
      // Update last saved count for next incremental save
      progressData.statistics.lastSavedQuestionCount = currentScore.total;
    }

    if (!progressData.statistics.milestones.firstQuizDate) {
      progressData.statistics.milestones.firstQuizDate = now;
    }

    // Update streak
    updateStreak(progressData);

    await AsyncStorage.setItem('@progress', JSON.stringify(progressData));
    console.log('[QUIZ] ✅ Saved session statistics:', {
      newQuestions,
      totalToday: dayStats.itemsReviewed,
      isComplete,
    });

    // Queue progress sync to server
    await syncManager.queueAction({
      type: 'SAVE_PROGRESS',
      data: progressData
    });

    return progressData;
  } catch (error) {
    console.error('[QUIZ] ❌ Error saving session statistics:', error);
    throw error;
  }
}

export default function QuizScreen() {
  const [quizMode, setQuizMode] = useState(null); // null | 'words' | 'sentences' | 'audio'
  const [quiz, setQuiz] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const [characters, setCharacters] = useState({});
  const [quizStartTime, setQuizStartTime] = useState(null); // Track time for quality suggestion
  const [feedbackMessage, setFeedbackMessage] = useState(null); // Show feedback after rating
  const [dueCount, setDueCount] = useState(0); // Count of due review cards
  const answeredInSessionRef = useRef(new Set()); // Track recently answered words (using ref for sync updates)

  useEffect(() => {
    loadCharacters();
    updateDueCount();
    // Cleanup: stop any speech when component unmounts
    return () => {
      Speech.stop();
    };
  }, []);

  // Debug state changes
  useEffect(() => {
    console.log('[QUIZ] 📊 State changed:', {
      currentIndex,
      revealed,
      hasFeedback: !!feedbackMessage,
      quizLength: quiz?.length || 0,
    });
  }, [currentIndex, revealed, feedbackMessage]);

  const updateDueCount = async () => {
    try {
      const cachedProgress = await AsyncStorage.getItem('@progress');
      if (!cachedProgress) return;

      const progressData = JSON.parse(cachedProgress);
      const now = Date.now();
      let count = 0;

      // Count due compound words
      if (progressData.compoundProgress) {
        Object.values(progressData.compoundProgress).forEach(charProgress => {
          if (charProgress.quizScores) {
            Object.values(charProgress.quizScores).forEach(quizData => {
              if (quizData.nextReview && quizData.nextReview <= now) {
                count++;
              }
            });
          }
        });
      }

      // Count due characters
      if (progressData.characterProgress) {
        Object.values(progressData.characterProgress).forEach(charData => {
          if (charData.quizScore?.nextReview && charData.quizScore.nextReview <= now) {
            count++;
          }
        });
      }

      setDueCount(count);
    } catch (error) {
      console.error('[QUIZ] Error updating due count:', error);
    }
  };

  // Text-to-Speech function for Chinese
  const speakChinese = (text) => {
    Speech.speak(text, {
      language: 'zh-CN', // Mandarin Chinese
      pitch: 1.0,
      rate: 0.75, // Slightly slower for learning
    });
  };

  const loadCharacters = async () => {
    try {
      const charData = require('../data/characters.json');
      setCharacters(charData);
    } catch (error) {
      console.error('[QUIZ] Error loading characters:', error);
    }
  };

  const startAudioQuiz = async () => {
    await startWordQuiz('audio');
  };

  const startWordQuiz = async (mode = 'words') => {
    try {
      // ALWAYS use local cache first (local is source of truth)
      let progressData = null;
      const cachedProgress = await AsyncStorage.getItem('@progress');
      if (cachedProgress) {
        progressData = JSON.parse(cachedProgress);
        console.log('[QUIZ] Loaded from local cache');
      } else {
        // Only fetch from server if no local data
        try {
          const result = await api.getProgress();
          console.log('[QUIZ] Server response:', result);
          if (result && typeof result === 'object') {
            progressData = result;
            await AsyncStorage.setItem('@progress', JSON.stringify(progressData));
            console.log('[QUIZ] Loaded from server (no local cache)');
          }
        } catch (error) {
          console.log('[QUIZ] Server error and no cache:', error.message);
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

      // Filter out items reviewed very recently (within last 5 minutes) to avoid repetition
      const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
      const eligibleItems = quizItems.filter(item => {
        if (!item.quizData || !item.quizData.lastReviewed) {
          return true; // Include new items
        }
        return item.quizData.lastReviewed < fiveMinutesAgo; // Exclude recently reviewed
      });

      console.log('[QUIZ] Filtered items:', {
        total: quizItems.length,
        eligible: eligibleItems.length,
        recentlyReviewed: quizItems.length - eligibleItems.length
      });

      // If less than 10 eligible items, use all items (user wants to practice)
      const itemsToQuiz = eligibleItems.length >= 10 ? eligibleItems : quizItems;

      // Use SM-2 prioritization: due items first, then struggling, then new, then mastered
      const prioritized = prioritizeQuizItems(itemsToQuiz);

      // Continuous mode: take first 10 for initial batch
      const batchSize = 10;
      const selectedItems = prioritized.slice(0, Math.min(batchSize, prioritized.length));

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
        mode: mode,
        totalItems: selectedItems.length,
        correctCount: 0,
        accuracy: 0,
        duration: 0,
      };
      await AsyncStorage.setItem('@progress', JSON.stringify(progressData));

      setQuiz(selectedItems);
      setQuizMode(mode);
      setCurrentIndex(0);
      setRevealed(false);
      setScore({ correct: 0, total: 0 });
      answeredInSessionRef.current = new Set(); // Reset answered tracking for new session

      // For audio quiz, auto-play the first word
      if (mode === 'audio' && selectedItems.length > 0) {
        setTimeout(() => {
          speakChinese(selectedItems[0].word);
        }, 500);
      }
    } catch (error) {
      console.error('[QUIZ] Error starting quiz:', error);
      Alert.alert('Error', 'Could not start quiz: ' + error.message);
    }
  };

  const revealAnswer = () => {
    console.log('[QUIZ] 🔍 Revealing answer - currentIndex:', currentIndex);
    setRevealed(true);
    setQuizStartTime(Date.now()); // Start timing from reveal (for quality suggestion)

    // Auto-play Chinese audio when revealing answer (except in audio mode which already plays)
    if (quizMode !== 'audio' && quiz && quiz[currentIndex]) {
      setTimeout(() => {
        speakChinese(quiz[currentIndex].word);
      }, 200); // Small delay to feel natural
    }
  };

  const markQuality = async (quality) => {
    console.log('[QUIZ] ⭐ Marking quality:', quality, 'at index:', currentIndex);

    // IMPORTANT: Reset revealed immediately to prevent flicker
    setRevealed(false);

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

      // Queue progress sync to server
      await syncManager.queueAction({
        type: 'SAVE_PROGRESS',
        data: progressData
      });

      // Track this word as answered in current session (using ref for immediate sync update)
      answeredInSessionRef.current.add(currentWord);
      console.log('[QUIZ] 📝 Added to answered set:', currentWord, '- Set size:', answeredInSessionRef.current.size);

      // Auto-save session statistics every 10 questions
      if (newScore.total > 0 && newScore.total % 10 === 0) {
        await saveSessionStatistics(newScore, false);

        if (Platform.OS === 'android') {
          ToastAndroid.show(
            `Progress saved! ${newScore.total} questions completed ✓`,
            ToastAndroid.SHORT
          );
        } else {
          console.log(`[QUIZ] Milestone: ${newScore.total} questions completed & saved`);
        }
      }

      // Show feedback with next review info
      const updatedData = itemType === 'character'
        ? progressData.characterProgress[currentWord].quizScore
        : progressData.compoundProgress[currentItem.char].quizScores[currentWord];

      const nextReviewStr = formatNextReview(updatedData.nextReview);
      const qualityStr = getQualityLabel(quality);
      const intervalDays = Math.round(updatedData.interval);

      setFeedbackMessage({
        quality: qualityStr,
        nextReview: nextReviewStr,
        interval: intervalDays,
        score: updatedData.score,
      });

      // Auto-advance after showing feedback
      setTimeout(() => {
        const advanceToNext = async () => {
          console.log('[QUIZ] ⏭️ Auto-advancing - clearing feedback');

          // Clear feedback (revealed was already reset when marking quality)
          setFeedbackMessage(null);

          // Find next unanswered question in the quiz array
          let nextIndex = currentIndex + 1;
          while (nextIndex < quiz.length && answeredInSessionRef.current.has(quiz[nextIndex].word)) {
            console.log('[QUIZ] ⏩ Skipping already answered:', quiz[nextIndex].word);
            nextIndex++;
          }

          if (nextIndex < quiz.length) {
            console.log('[QUIZ] ⏭️ Moving to next question:', nextIndex);
            setCurrentIndex(nextIndex);

            // Auto-play audio for next question in audio mode
            if (quizMode === 'audio') {
              setTimeout(() => {
                speakChinese(quiz[nextIndex].word);
              }, 300);
            }
          } else {
            // End of current batch - load more questions
            const hasMore = await loadNextBatch();
            if (hasMore) {
              // Find first unanswered in new batch
              nextIndex = currentIndex + 1;
              while (nextIndex < quiz.length && answeredInSessionRef.current.has(quiz[nextIndex].word)) {
                nextIndex++;
              }

              if (nextIndex < quiz.length) {
                // IMPORTANT: Reset revealed BEFORE changing index
                setRevealed(false);
                setCurrentIndex(nextIndex);

                // Auto-play audio for next question in audio mode
                if (quizMode === 'audio') {
                  setTimeout(() => {
                    speakChinese(quiz[nextIndex].word);
                  }, 300);
                }
              } else {
                // No unanswered items available
                finishQuiz(newScore);
              }
            } else {
              // No more items available, finish quiz
              finishQuiz(newScore);
            }
          }
        };
        advanceToNext();
      }, 2000); // Show feedback for 2 seconds
    } catch (error) {
      console.error('[QUIZ] Error saving quiz result:', error);
    }
  };

  const loadNextBatch = async () => {
    try {
      console.log('[QUIZ] Loading next batch of questions...');

      // Get current progress
      const cachedProgress = await AsyncStorage.getItem('@progress');
      const progressData = cachedProgress ? JSON.parse(cachedProgress) : null;

      if (!progressData) {
        console.error('[QUIZ] No progress data found');
        return false;
      }

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
              quizData: charData.quizScore || null,
            });
          }
        });
      }

      // Add compound words
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
                    quizData: charProgress.quizScores?.[word] || null,
                  });
                }
              });
            }
          }
        });
      }

      // IMPORTANT: Filter in correct order to prevent same questions appearing
      // 1. Filter out recently reviewed words (time-based)
      const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
      const unrecentlyReviewedItems = quizItems.filter(item => {
        // Exclude words reviewed in last 10 minutes (prevents immediate repetition)
        // This allows cycling through all known words without seeing same ones too quickly
        if (item.quizData && item.quizData.lastReviewed && item.quizData.lastReviewed >= tenMinutesAgo) {
          return false;
        }
        return true;
      });

      // 2. Then filter out items already in current quiz array
      const currentWords = quiz.map(item => item.word);
      const eligibleItems = unrecentlyReviewedItems.filter(item => !currentWords.includes(item.word));

      console.log('[QUIZ] Filtering:', {
        total: quizItems.length,
        unrecentlyReviewed: unrecentlyReviewedItems.length,
        eligible: eligibleItems.length,
        currentQuizSize: quiz.length,
        tenMinCutoff: new Date(tenMinutesAgo).toLocaleTimeString()
      });

      // ALWAYS use eligibleItems (never show words already in quiz)
      if (eligibleItems.length === 0) {
        console.log('[QUIZ] No more eligible items available');
        return false;
      }

      // Prioritize and select next batch
      const prioritized = prioritizeQuizItems(eligibleItems);
      const batchSize = 10;
      const nextBatch = prioritized.slice(0, Math.min(batchSize, prioritized.length));

      console.log('[QUIZ] Loaded', nextBatch.length, 'new questions');

      // DON'T clear answeredInSessionRef here - keep tracking across batches
      // This prevents words from repeating within the same quiz session
      // answeredInSessionRef is only cleared when starting a completely new session

      // Append to current quiz
      setQuiz(prev => [...prev, ...nextBatch]);

      // Update session totalItems
      if (progressData.statistics.currentSession) {
        progressData.statistics.currentSession.totalItems += nextBatch.length;
        await AsyncStorage.setItem('@progress', JSON.stringify(progressData));
      }

      return true;
    } catch (error) {
      console.error('[QUIZ] Error loading next batch:', error);
      return false;
    }
  };

  const finishQuiz = async (finalScoreObj) => {
    const finalScore = finalScoreObj.correct;
    const finalTotal = finalScoreObj.total;
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
  };


  const quitQuiz = async () => {
    const handleQuit = async () => {
      // Save session statistics before quitting
      if (score.total > 0) {
        try {
          await saveSessionStatistics(score, false);
          console.log('[QUIZ] Saved session statistics on quit');
        } catch (error) {
          console.error('[QUIZ] Error saving session statistics on quit:', error);
        }
      }
      setQuizMode(null);
    };

    Alert.alert(
      'Quit Quiz?',
      score.total > 0
        ? `You've completed ${score.total} question${score.total === 1 ? '' : 's'}. Your progress and statistics will be saved.`
        : 'Are you sure you want to quit?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Quit', onPress: handleQuit, style: 'destructive' },
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
            onPress={() => startWordQuiz()}
          >
            <Text style={styles.modeIcon}>📝</Text>
            <Text style={styles.modeTitle}>Word Quiz</Text>
            <Text style={styles.modeDesc}>Visual quiz with text and pinyin</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.modeButton}
            onPress={() => startAudioQuiz()}
          >
            <Text style={styles.modeIcon}>🔊</Text>
            <Text style={styles.modeTitle}>Audio Quiz</Text>
            <Text style={styles.modeDesc}>Listening comprehension practice</Text>
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

        {dueCount > 0 && (
          <View style={styles.dueCardsContainer}>
            <Text style={styles.dueCardsTitle}>📅 {dueCount} card{dueCount === 1 ? '' : 's'} due for review!</Text>
            <Text style={styles.dueCardsDesc}>Time to practice your spaced repetition</Text>
          </View>
        )}

        <View style={styles.statsContainer}>
          <Text style={styles.statsTitle}>Quiz Tips:</Text>
          <Text style={styles.statsTip}>• Long-press characters in the Home tab to mark them as known</Text>
          <Text style={styles.statsTip}>• Known characters unlock compound word quizzes</Text>
          <Text style={styles.statsTip}>• Quiz yourself regularly for better retention</Text>
          <Text style={styles.statsTip}>• Audio quiz helps with listening comprehension (听力)</Text>
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

  // Safety check: if currentIndex is out of bounds, return loading state
  if (!currentItem) {
    console.log('[QUIZ] ⚠️ currentItem is undefined - currentIndex:', currentIndex, 'quiz.length:', quiz.length);
    return (
      <View style={styles.container}>
        <Text>Loading next question...</Text>
      </View>
    );
  }

  // Determine quiz direction based on consecutive correct (progressive difficulty)
  const direction = getQuizDirection(currentItem.quizData);
  const isReversed = direction === 'english-to-chinese';
  const isAudioMode = quizMode === 'audio';

  console.log('[QUIZ] 🎯 Rendering quiz for:', currentItem.word, '- direction:', direction, 'isReversed:', isReversed, 'isAudioMode:', isAudioMode);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Compact header */}
      <View style={styles.compactHeader}>
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={quitQuiz} style={styles.quitButton}>
            <Text style={styles.quitButtonText}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.questionNumber}>Question {score.total + 1}</Text>
        </View>
        <Image
          source={require('../../assets/logo-icon-only.png')}
          style={styles.headerLogo}
          resizeMode="contain"
        />
        <View style={styles.headerRight}>
          <Text style={styles.scoreText}>{score.correct}/{score.total}</Text>
          {isAudioMode && <Text style={styles.modeBadge}>🎧</Text>}
          {!isAudioMode && isReversed && <Text style={styles.modeBadge}>🔥</Text>}
        </View>
      </View>

      {/* Main content area - no ScrollView, fixed layout */}
      <View style={styles.contentArea}>
        {/* Quiz Card */}
        <View style={styles.quizCard}>
        {isAudioMode ? (
          <>
            {/* Audio Mode: Play audio, hide characters until revealed */}
            {!revealed ? (
              <View style={styles.audioPrompt}>
                <TouchableOpacity
                  style={styles.playSoundButton}
                  onPress={() => speakChinese(currentItem.word)}
                >
                  <Text style={styles.playSoundIcon}>🔊</Text>
                  <Text style={styles.playSoundText}>Tap to hear again</Text>
                </TouchableOpacity>
                <Text style={styles.audioHint}>Listen and recall the meaning</Text>
              </View>
            ) : (
              <>
                <View style={styles.wordWithSpeaker}>
                  <Text style={styles.quizWord}>{currentItem.word}</Text>
                  <TouchableOpacity
                    style={styles.speakerButton}
                    onPress={() => speakChinese(currentItem.word)}
                  >
                    <Text style={styles.speakerIcon}>🔊</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.quizPinyin}>{currentItem.pinyin}</Text>
                <View style={styles.meaningContainer}>
                  <Text style={styles.meaningLabel}>Meaning:</Text>
                  {currentItem.meanings.map((meaning, idx) => (
                    <Text key={idx} style={styles.quizMeaning}>
                      • {meaning}
                    </Text>
                  ))}
                </View>
              </>
            )}
          </>
        ) : !isReversed ? (
          <>
            {/* Normal: Show Chinese, recall English */}
            {console.log('[QUIZ] 📱 Rendering NORMAL mode - word:', currentItem.word, 'pinyin:', currentItem.pinyin, 'meanings:', currentItem.meanings)}
            <View style={styles.wordWithSpeaker}>
              <Text style={styles.quizWord}>{currentItem.word}</Text>
              <TouchableOpacity
                style={styles.speakerButton}
                onPress={() => speakChinese(currentItem.word)}
              >
                <Text style={styles.speakerIcon}>🔊</Text>
              </TouchableOpacity>
            </View>
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
          </>
        ) : (
          <>
            {/* Reversed: Show English, recall Chinese */}
            <View style={styles.meaningContainer}>
              <Text style={styles.meaningLabel}>Recall the Chinese word for:</Text>
              {currentItem.meanings.map((meaning, idx) => (
                <Text key={idx} style={styles.quizMeaning}>
                  • {meaning}
                </Text>
              ))}
            </View>

            {revealed && (
              <>
                <View style={styles.wordWithSpeaker}>
                  <Text style={[styles.quizWord, { marginTop: 20 }]}>{currentItem.word}</Text>
                  <TouchableOpacity
                    style={styles.speakerButton}
                    onPress={() => speakChinese(currentItem.word)}
                  >
                    <Text style={styles.speakerIcon}>🔊</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.quizPinyin}>{currentItem.pinyin}</Text>
              </>
            )}
          </>
        )}
        </View>
      </View>

      {/* Fixed bottom actions */}
      <View style={styles.bottomActionsContainer}>
        {(() => {
          console.log('[QUIZ] 🎨 Rendering bottom - feedbackMessage:', !!feedbackMessage, 'revealed:', revealed);
          return null;
        })()}
        {feedbackMessage ? (
          <TouchableOpacity
            style={styles.feedbackContainer}
            onPress={() => {
              const skipToNext = async () => {
                console.log('[QUIZ] ⏩ Manual skip - resetting state');
                // IMPORTANT: Reset revealed BEFORE clearing feedback to prevent race condition
                setRevealed(false);
                setFeedbackMessage(null);

                // Find next unanswered question in the quiz array
                let nextIndex = currentIndex + 1;
                while (nextIndex < quiz.length && answeredInSessionRef.current.has(quiz[nextIndex].word)) {
                  console.log('[QUIZ] ⏩ Skipping already answered:', quiz[nextIndex].word);
                  nextIndex++;
                }

                if (nextIndex < quiz.length) {
                  console.log('[QUIZ] ⏩ Skipping to question:', nextIndex);
                  setCurrentIndex(nextIndex);

                  // Auto-play audio for next question in audio mode
                  if (quizMode === 'audio') {
                    setTimeout(() => {
                      speakChinese(quiz[nextIndex].word);
                    }, 300);
                  }
                } else {
                  // End of current batch - load more questions
                  const hasMore = await loadNextBatch();
                  if (hasMore) {
                    // Find first unanswered in new batch
                    nextIndex = currentIndex + 1;
                    while (nextIndex < quiz.length && answeredInSessionRef.current.has(quiz[nextIndex].word)) {
                      nextIndex++;
                    }

                    if (nextIndex < quiz.length) {
                      setCurrentIndex(nextIndex);

                      // Auto-play audio for next question in audio mode
                      if (quizMode === 'audio') {
                        setTimeout(() => {
                          speakChinese(quiz[nextIndex].word);
                        }, 300);
                      }
                    } else {
                      // No unanswered items available
                      finishQuiz(score);
                    }
                  } else {
                    // No more items available, finish quiz
                    finishQuiz(score);
                  }
                }
              };
              skipToNext();
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.feedbackTitle}>{feedbackMessage.quality}</Text>
            <View style={styles.feedbackDetails}>
              <Text style={styles.feedbackText}>
                Next review: <Text style={styles.feedbackValue}>{feedbackMessage.nextReview}</Text>
              </Text>
              <Text style={styles.feedbackText}>
                Interval: <Text style={styles.feedbackValue}>{feedbackMessage.interval} {feedbackMessage.interval === 1 ? 'day' : 'days'}</Text>
              </Text>
              <Text style={styles.feedbackText}>
                Score: <Text style={styles.feedbackValue}>{feedbackMessage.score}/5</Text>
              </Text>
            </View>
            <Text style={styles.tapToSkipHint}>Tap to continue →</Text>
          </TouchableOpacity>
        ) : !revealed ? (
          <>
            {console.log('[QUIZ] ✅ RENDERING REVEAL BUTTON - revealed:', revealed, 'feedbackMessage:', feedbackMessage)}
            <TouchableOpacity
              style={styles.revealButton}
              onPress={revealAnswer}
              activeOpacity={0.8}
            >
              <Text style={styles.quizButtonText}>👁️ Reveal Answer</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            {console.log('[QUIZ] ⭐ RENDERING QUALITY BUTTONS - revealed:', revealed, 'feedbackMessage:', feedbackMessage)}
            <View style={styles.qualityRatingContainer}>
              <View style={styles.qualityButtonsRow}>
              <TouchableOpacity
                style={[styles.qualityButtonCompact, styles.quality0]}
                onPress={() => {
                  Vibration.vibrate(50);
                  markQuality(0);
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.qualityEmoji}>😵</Text>
                <Text style={styles.qualityText}>Forgot</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.qualityButtonCompact, styles.quality2]}
                onPress={() => {
                  Vibration.vibrate(50);
                  markQuality(2);
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.qualityEmoji}>😕</Text>
                <Text style={styles.qualityText}>Hard</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.qualityButtonCompact, styles.quality4]}
                onPress={() => {
                  Vibration.vibrate(50);
                  markQuality(4);
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.qualityEmoji}>🙂</Text>
                <Text style={styles.qualityText}>Good</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.qualityButtonCompact, styles.quality5]}
                onPress={() => {
                  Vibration.vibrate(50);
                  markQuality(5);
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.qualityEmoji}>😄</Text>
                <Text style={styles.qualityText}>Perfect</Text>
              </TouchableOpacity>
            </View>
          </View>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.lightGray,
  },
  compactHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.primaryLight,
    backgroundColor: COLORS.white,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerLogo: {
    width: 32,
    height: 32,
  },
  quitButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quitButtonText: {
    fontSize: 18,
    color: COLORS.textMedium,
  },
  questionNumber: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textDark,
  },
  scoreText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.primary,
  },
  modeBadge: {
    fontSize: 20,
  },
  contentArea: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  bottomActionsContainer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderTopColor: COLORS.primaryLight,
    backgroundColor: COLORS.white,
  },
  header: {
    backgroundColor: COLORS.primary,
    paddingTop: 40,
    paddingBottom: 48,
    paddingHorizontal: 30,
    alignItems: 'center',
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 8,
  },
  title: {
    fontSize: 38,
    fontWeight: '800',
    color: COLORS.white,
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 17,
    color: COLORS.white,
    opacity: 0.95,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
  modeContainer: {
    padding: 20,
    paddingTop: 24,
  },
  modeButton: {
    backgroundColor: COLORS.white,
    borderRadius: 20,
    padding: 28,
    paddingVertical: 32,
    marginBottom: 18,
    alignItems: 'center',
    shadowColor: COLORS.textDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
    borderWidth: 0,
    borderLeftWidth: 5,
    borderLeftColor: COLORS.primary,
    transform: [{ scale: 1 }],
  },
  modeButtonDisabled: {
    opacity: 0.5,
    borderLeftColor: COLORS.mediumGray,
  },
  modeIcon: {
    fontSize: 56,
    marginBottom: 14,
  },
  modeTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.textDark,
    marginBottom: 8,
    letterSpacing: 0.3,
  },
  modeDesc: {
    fontSize: 15,
    color: COLORS.textMedium,
    textAlign: 'center',
    fontWeight: '500',
    lineHeight: 21,
  },
  dueCardsContainer: {
    backgroundColor: COLORS.primaryLight,
    margin: 20,
    marginBottom: 0,
    marginTop: 10,
    padding: 24,
    borderRadius: 18,
    borderLeftWidth: 6,
    borderLeftColor: COLORS.primary,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  },
  dueCardsTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.primary,
    marginBottom: 6,
    letterSpacing: 0.3,
  },
  dueCardsDesc: {
    fontSize: 15,
    color: COLORS.textDark,
    fontWeight: '500',
    lineHeight: 22,
  },
  statsContainer: {
    backgroundColor: COLORS.white,
    margin: 20,
    padding: 24,
    borderRadius: 18,
    borderWidth: 0,
    borderLeftWidth: 5,
    borderLeftColor: COLORS.primaryLight,
    shadowColor: COLORS.textDark,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
  },
  statsTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.textDark,
    marginBottom: 14,
    letterSpacing: 0.3,
  },
  statsTip: {
    fontSize: 15,
    color: COLORS.textMedium,
    marginVertical: 5,
    lineHeight: 22,
    fontWeight: '500',
  },
  quizHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    backgroundColor: COLORS.primary,
  },
  quizProgress: {
    fontSize: 16,
    color: COLORS.white,
    fontWeight: '600',
  },
  quitButton: {
    fontSize: 16,
    color: COLORS.white,
    fontWeight: '600',
  },
  scoreContainer: {
    padding: 16,
    backgroundColor: COLORS.white,
    alignItems: 'center',
  },
  scoreText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  difficultyBadge: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.error,
    marginTop: 4,
  },
  quizCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
    backgroundColor: COLORS.white,
    borderRadius: 24,
    borderWidth: 0,
    borderLeftWidth: 6,
    borderLeftColor: COLORS.primary,
    padding: 32,
    minHeight: 220,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 6,
  },
  wordWithSpeaker: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  quizWord: {
    fontSize: 40,
    fontWeight: 'bold',
    color: COLORS.textDark,
    marginBottom: 8,
  },
  speakerButton: {
    padding: 12,
    marginBottom: 12,
    backgroundColor: COLORS.primaryLight,
    borderRadius: 50,
    width: 56,
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  speakerIcon: {
    fontSize: 28,
  },
  quizPinyin: {
    fontSize: 18,
    color: COLORS.primary,
    marginBottom: 12,
  },
  meaningContainer: {
    width: '100%',
    marginTop: 12,
    padding: 16,
    backgroundColor: COLORS.lightGray,
    borderRadius: 8,
  },
  meaningLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    color: COLORS.textMedium,
    marginBottom: 8,
  },
  quizMeaning: {
    fontSize: 16,
    color: COLORS.textDark,
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
    backgroundColor: COLORS.primary,
    paddingVertical: 18,
    paddingHorizontal: 24,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  correctButton: {
    backgroundColor: COLORS.success,
  },
  wrongButton: {
    backgroundColor: COLORS.error,
  },
  quizButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
  },
  qualityRatingContainer: {
    width: '100%',
  },
  qualityButtonsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  qualityButtonCompact: {
    flex: 1,
    paddingVertical: 18,
    paddingHorizontal: 10,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 3,
    borderColor: COLORS.mediumGray,
    minHeight: 85,
    justifyContent: 'center',
    shadowColor: COLORS.textDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  qualityEmoji: {
    fontSize: 32,
    marginBottom: 8,
  },
  qualityText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textMedium,
    letterSpacing: 0.3,
  },
  quality0: {
    backgroundColor: COLORS.qualityForgot.bg,
    borderColor: COLORS.qualityForgot.border,
  },
  quality1: {
    backgroundColor: COLORS.qualityHard.bg,
    borderColor: COLORS.qualityHard.border,
  },
  quality2: {
    backgroundColor: COLORS.qualityHard.bg,
    borderColor: COLORS.qualityHard.border,
  },
  quality3: {
    backgroundColor: COLORS.qualityGood.bg,
    borderColor: COLORS.qualityGood.border,
  },
  quality4: {
    backgroundColor: COLORS.qualityGood.bg,
    borderColor: COLORS.qualityGood.border,
  },
  quality5: {
    backgroundColor: COLORS.qualityPerfect.bg,
    borderColor: COLORS.qualityPerfect.border,
  },
  feedbackContainer: {
    backgroundColor: COLORS.primaryLight,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.primary,
  },
  feedbackTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.primary,
    marginBottom: 12,
  },
  feedbackDetails: {
    flexDirection: 'row',
    gap: 16,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  feedbackText: {
    fontSize: 13,
    color: COLORS.textMedium,
  },
  feedbackValue: {
    fontWeight: 'bold',
    color: COLORS.textDark,
  },
  tapToSkipHint: {
    fontSize: 12,
    color: COLORS.primary,
    marginTop: 8,
    fontStyle: 'italic',
  },
  audioPrompt: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  playSoundButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 30,
    paddingHorizontal: 40,
    borderRadius: 50,
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  playSoundIcon: {
    fontSize: 64,
  },
  playSoundText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
    marginTop: 10,
  },
  audioHint: {
    fontSize: 16,
    color: COLORS.textMedium,
    textAlign: 'center',
    marginTop: 10,
  },
});
