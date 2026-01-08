import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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

const QuizScreen = React.memo(() => {
  const [quizMode, setQuizMode] = useState(null); // null | 'words' | 'sentences' | 'audio'
  const [quiz, setQuiz] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const [characters, setCharacters] = useState({});
  const [quizStartTime, setQuizStartTime] = useState(null); // Track time for quality suggestion
  const [feedbackMessage, setFeedbackMessage] = useState(null); // Show feedback after rating
  const [dueCount, setDueCount] = useState(0); // Count of due review cards
  const [practiceMode, setPracticeMode] = useState(false); // FIX 3: Practice mode bypasses "reviewed today" filter
  const answeredInSessionRef = useRef(new Set()); // Track words that passed (quality >= 3)
  const learningQueueRef = useRef([]); // Anki-style learning queue for failed cards
  // learningQueueRef format: [{ word, item, step, cardsUntilReview }, ...]
  const advanceTimeoutRef = useRef(null); // Track pending auto-advance timeout to prevent race conditions

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
  const speakChinese = useCallback((text) => {
    Speech.speak(text, {
      language: 'zh-CN', // Mandarin Chinese
      pitch: 1.0,
      rate: 0.75, // Slightly slower for learning
    });
  }, []);

  const loadCharacters = useCallback(async () => {
    try {
      const charData = require('../data/characters.json');
      setCharacters(charData);
    } catch (error) {
      console.error('[QUIZ] Error loading characters:', error);
    }
  }, []);

  const startAudioQuiz = async () => {
    await startWordQuiz('audio');
  };

  const startSentenceQuiz = async () => {
    try {
      // Load progress data to find mastered characters
      const cachedProgress = await AsyncStorage.getItem('@progress');
      if (!cachedProgress) {
        Alert.alert('No Progress', 'No characters found in your progress. Mark some characters as known first!');
        return;
      }

      const progressData = JSON.parse(cachedProgress);

      // Get all characters the user has marked as known
      const knownChars = progressData.characterProgress
        ? Object.keys(progressData.characterProgress).filter(char =>
            progressData.characterProgress[char]?.known
          )
        : [];

      if (knownChars.length === 0) {
        Alert.alert('No Characters', 'No characters found in your progress. Long-press characters in the Home tab to mark them as known!');
        return;
      }

      // FIX 4: Track which characters have sentences for better error messages
      const sentenceItems = [];
      const checkedChars = [];
      const charsWithSentences = [];
      const charsWithoutSentences = [];

      for (const char of knownChars.slice(0, 20)) { // Limit to first 20 characters to avoid slow loading
        checkedChars.push(char);
        try {
          const data = await api.getSentences(char);

          if (data.success && data.senses && data.senses.length > 0) {
            let hasAnySentence = false;
            // Add sentences from each sense
            data.senses.forEach(sense => {
              if (sense.sentences && sense.sentences.length > 0) {
                hasAnySentence = true;
                sense.sentences.forEach(sentence => {
                  sentenceItems.push({
                    type: 'sentence',
                    character: char,
                    senseId: sense.senseId,
                    senseMeaning: sense.meaning,
                    chinese: sentence.chinese,
                    pinyin: sentence.pinyin,
                    english: sentence.english,
                    sentenceId: sentence.id,
                    mastery: sense.mastery || 0,
                  });
                });
              }
            });
            if (hasAnySentence) {
              charsWithSentences.push(char);
            } else {
              charsWithoutSentences.push(char);
            }
          } else {
            charsWithoutSentences.push(char);
          }
        } catch (error) {
          console.log(`[QUIZ] Could not load sentences for ${char}:`, error.message);
          charsWithoutSentences.push(char);
        }
      }

      // FIX 4: Better error message showing which characters were checked
      if (sentenceItems.length === 0) {
        Alert.alert(
          'No Sentences Available',
          `Checked ${checkedChars.length} characters:\n\n` +
          `✅ Characters with sentences: ${charsWithSentences.length > 0 ? charsWithSentences.join(', ') : 'None'}\n\n` +
          `❌ Characters without sentences: ${charsWithoutSentences.join(', ')}\n\n` +
          `Total known characters: ${knownChars.length}\n\n` +
          `The server may need to be configured with sentence data for these characters.`
        );
        return;
      }

      // Shuffle and select random sentences
      const shuffled = sentenceItems.sort(() => Math.random() - 0.5);
      const selectedSentences = shuffled.slice(0, Math.min(10, shuffled.length));

      console.log('[QUIZ] Loaded', selectedSentences.length, 'sentences for quiz');

      // Initialize quiz session
      progressData.statistics.currentSession = {
        startTime: Date.now(),
        endTime: null,
        mode: 'sentences',
        totalItems: selectedSentences.length,
        correctCount: 0,
        accuracy: 0,
        duration: 0,
      };
      await AsyncStorage.setItem('@progress', JSON.stringify(progressData));

      setQuiz(selectedSentences);
      setQuizMode('sentences');
      setCurrentIndex(0);
      setRevealed(false);
      setScore({ correct: 0, total: 0 });
      answeredInSessionRef.current = new Set();
    } catch (error) {
      console.error('[QUIZ] Error starting sentence quiz:', error);
      Alert.alert('Error', 'Could not start sentence quiz: ' + error.message);
    }
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

      // Count breakdown
      const characterCount = quizItems.filter(item => item.type === 'character').length;
      const compoundCount = quizItems.filter(item => item.type === 'compound').length;

      console.log('[QUIZ] Progress data structure:', {
        hasCharacterProgress: !!progressData.characterProgress,
        characterProgressKeys: progressData.characterProgress ? Object.keys(progressData.characterProgress).length : 0,
        hasCompoundProgress: !!progressData.compoundProgress,
        compoundProgressKeys: progressData.compoundProgress ? Object.keys(progressData.compoundProgress).length : 0,
        sampleCharProgress: progressData.characterProgress ? Object.entries(progressData.characterProgress).slice(0, 2) : [],
        sampleCompoundProgress: progressData.compoundProgress ? Object.entries(progressData.compoundProgress).slice(0, 2) : []
      });
      console.log('[QUIZ] 📊 Item breakdown:', {
        totalItems: quizItems.length,
        characters: characterCount,
        compounds: compoundCount,
        sampleCompounds: quizItems.filter(item => item.type === 'compound').slice(0, 5).map(item => item.word)
      });

      if (quizItems.length === 0) {
        Alert.alert(
          'No Items Yet',
          'No characters or words found in your progress. Long-press characters on the Home screen to mark them as known, or tap compound words in the character detail screen!'
        );
        return;
      }

      // ANKI-STYLE FILTERING: Only show due/overdue items (unless user wants to practice anyway)
      const now = Date.now();
      const today = new Date().setHours(23, 59, 59, 999);
      const todayStart = new Date().setHours(0, 0, 0, 0);

      // Categorize items by review status
      const categorized = quizItems.map(item => {
        const quizData = item.quizData;

        // For Audio/Sentence quiz: Only show cards that have been reviewed in Word quiz at least once (unless practice mode)
        if (!practiceMode && (mode === 'audio' || mode === 'sentences')) {
          if (!quizData || !quizData.lastReviewedWord) {
            // Not yet reviewed in word quiz - skip
            return { ...item, category: 'not-available', dueStatus: 'not-available' };
          }
        }

        // New items (never reviewed in THIS mode)
        if (!quizData || !quizData.nextReview) {
          return { ...item, category: 'new', dueStatus: 'new' };
        }

        const nextReview = quizData.nextReview;

        // Check if already reviewed today IN THIS SPECIFIC MODE
        let lastReviewed;
        if (mode === 'audio') {
          lastReviewed = quizData.lastReviewedAudio;
        } else if (mode === 'sentences') {
          lastReviewed = quizData.lastReviewedSentence;
        } else {
          lastReviewed = quizData.lastReviewedWord || quizData.lastReviewed; // Fallback to legacy
        }

        const reviewedToday = lastReviewed && lastReviewed >= todayStart;

        // FIX 3: In practice mode, ignore "reviewed today" filter
        if (practiceMode && reviewedToday) {
          // Treat as if not reviewed today
          if (now >= nextReview) {
            return {
              ...item,
              category: 'overdue',
              dueStatus: 'overdue',
              daysOverdue: Math.floor((now - nextReview) / (24 * 60 * 60 * 1000))
            };
          }
          if (nextReview <= today) {
            return {
              ...item,
              category: 'due-today',
              dueStatus: 'due-today'
            };
          }
        }

        // Overdue
        if (now >= nextReview) {
          return {
            ...item,
            category: reviewedToday ? 'reviewed-today' : 'overdue',
            dueStatus: 'overdue',
            daysOverdue: Math.floor((now - nextReview) / (24 * 60 * 60 * 1000))
          };
        }

        // Due today
        if (nextReview <= today) {
          return {
            ...item,
            category: reviewedToday ? 'reviewed-today' : 'due-today',
            dueStatus: 'due-today'
          };
        }

        // Future review
        return { ...item, category: 'not-due', dueStatus: 'future' };
      });

      // Filter: show overdue + due-today + new (exclude already reviewed today and future items)
      const dueItems = categorized.filter(item =>
        item.category === 'overdue' ||
        item.category === 'due-today' ||
        item.category === 'new'
      );

      const reviewedTodayCount = categorized.filter(item => item.category === 'reviewed-today').length;
      const notDueCount = categorized.filter(item => item.category === 'not-due').length;

      console.log('[QUIZ] 📅 Anki-style filtering:', {
        total: quizItems.length,
        overdue: categorized.filter(i => i.category === 'overdue').length,
        dueToday: categorized.filter(i => i.category === 'due-today').length,
        new: categorized.filter(i => i.category === 'new').length,
        reviewedToday: reviewedTodayCount,
        notDue: notDueCount,
        eligible: dueItems.length
      });

      // If no items due, show "all caught up" message
      if (dueItems.length === 0) {
        const nextDueItem = categorized
          .filter(item => item.category === 'not-due')
          .sort((a, b) => (a.quizData?.nextReview || 0) - (b.quizData?.nextReview || 0))[0];

        const nextDueDate = nextDueItem?.quizData?.nextReview
          ? new Date(nextDueItem.quizData.nextReview).toLocaleDateString()
          : 'unknown';

        Alert.alert(
          '🎉 All Caught Up!',
          `Great work! You've completed all reviews for today.\n\n` +
          `📊 Summary:\n` +
          `• Reviewed today: ${reviewedTodayCount}\n` +
          `• Not due yet: ${notDueCount}\n` +
          `• Next review: ${nextDueDate}\n\n` +
          `Want to practice anyway?`,
          [
            { text: 'Done for Today', style: 'cancel' },
            {
              text: 'Practice Anyway',
              onPress: () => {
                // FIX 3: Restart with all items (practice mode)
                console.log('[QUIZ] User chose to practice anyway - enabling practice mode');
                setPracticeMode(true);
                // Restart quiz in practice mode
                setTimeout(() => {
                  startWordQuiz(mode);
                }, 100);
              }
            }
          ]
        );
        return;
      }

      const itemsToQuiz = dueItems;

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
      learningQueueRef.current = []; // Reset learning queue for new session

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

  const revealAnswer = useCallback(() => {
    console.log('[QUIZ] 🔍 Revealing answer - currentIndex:', currentIndex);
    setRevealed(true);
    setQuizStartTime(Date.now()); // Start timing from reveal (for quality suggestion)

    // Auto-play Chinese audio when revealing answer (except in audio mode which already plays)
    if (quizMode !== 'audio' && quiz && quiz[currentIndex]) {
      setTimeout(() => {
        speakChinese(quiz[currentIndex].word || quiz[currentIndex].chinese);
      }, 200); // Small delay to feel natural
    }
  }, [currentIndex, quizMode, quiz, speakChinese]);

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
      const itemType = currentItem.type; // 'character', 'compound', or 'sentence'

      const cachedProgress = await AsyncStorage.getItem('@progress');
      const progressData = cachedProgress ? JSON.parse(cachedProgress) : { characterProgress: {}, compoundProgress: {} };

      // Initialize progress objects if needed
      if (!progressData.compoundProgress) {
        progressData.compoundProgress = {};
      }
      if (!progressData.characterProgress) {
        progressData.characterProgress = {};
      }

      // Variable to store old quiz data before SM-2 calculation (for audit logging)
      let oldQuizData = null;

      // Track progress based on item type
      if (itemType === 'sentence') {
        // For sentence quiz, we don't use SM-2 algorithm
        // Instead, we'll batch results and send to API at the end
        // Track this sentence as answered in current session
        const sentenceKey = `${currentItem.character}-${currentItem.senseId}-${currentItem.sentenceId}`;
        answeredInSessionRef.current.add(sentenceKey);

        // Store sentence result in memory for batch submission
        if (!progressData.sentenceResults) {
          progressData.sentenceResults = [];
        }
        progressData.sentenceResults.push({
          character: currentItem.character,
          senseId: currentItem.senseId,
          sentenceId: currentItem.sentenceId,
          correct: isCorrect,
        });

        await AsyncStorage.setItem('@progress', JSON.stringify(progressData));
        console.log('[QUIZ] Saved sentence result for', currentItem.chinese, '- correct:', isCorrect);

        // Show simple feedback for sentences
        setFeedbackMessage({
          quality: isCorrect ? 'Correct!' : 'Incorrect',
          nextReview: null,
          interval: null,
          score: null,
        });
      } else if (itemType === 'character') {
        if (!progressData.characterProgress[currentWord]) {
          progressData.characterProgress[currentWord] = { known: true };
        }
        if (!progressData.characterProgress[currentWord].quizScore) {
          progressData.characterProgress[currentWord].quizScore = null;
        }

        // Store old data BEFORE SM-2 calculation for audit logging
        oldQuizData = progressData.characterProgress[currentWord].quizScore;

        // Use SM-2 algorithm to calculate next review (pass quiz mode for separate tracking)
        const updatedQuizData = calculateNextReview(
          progressData.characterProgress[currentWord].quizScore,
          quality,
          quizMode
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

        // Store old data BEFORE SM-2 calculation for audit logging
        oldQuizData = progressData.compoundProgress[char].quizScores[currentWord];

        // Use SM-2 algorithm to calculate next review (pass quiz mode for separate tracking)
        const updatedQuizData = calculateNextReview(
          progressData.compoundProgress[char].quizScores[currentWord],
          quality,
          quizMode
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

      // AUDIT LOGGING: Log quiz attempt to server (non-blocking)
      if (itemType !== 'sentence') {
        const updatedQuizData = itemType === 'character'
          ? progressData.characterProgress[currentWord].quizScore
          : progressData.compoundProgress[currentItem.char].quizScores[currentWord];

        const sessionId = progressData.statistics?.currentSession?.startTime
          ? String(progressData.statistics.currentSession.startTime)
          : String(Date.now());

        api.logQuizAttempt({
          word: currentWord,
          wordType: itemType,
          quizMode: quizMode,
          quality: quality,
          isCorrect: isCorrect,
          intervalBefore: oldQuizData?.interval || 0,
          intervalAfter: updatedQuizData?.interval || 0,
          easinessBefore: oldQuizData?.easiness || 2.5,
          easinessAfter: updatedQuizData?.easiness || 2.5,
          scoreBefore: oldQuizData?.score || 0,
          scoreAfter: updatedQuizData?.score || 0,
          sessionId: sessionId
        });
      }

      // ANKI-STYLE LEARNING QUEUE:
      // Only mark as "answered" if PASSED (quality >= 3)
      // Failed cards (quality < 3) go to learning queue and will be re-asked
      if (isCorrect) {
        answeredInSessionRef.current.add(currentWord);
        console.log('[QUIZ] ✅ Passed! Added to answered set:', currentWord);
      } else {
        // Failed card - add to learning queue
        const existingLearning = learningQueueRef.current.find(l => l.word === currentWord);
        if (existingLearning) {
          // Already in learning - increment step
          existingLearning.step++;
          existingLearning.cardsUntilReview = existingLearning.step === 1 ? 10 : 20; // 5 cards → 10 cards → 20 cards
          console.log('[QUIZ] ❌ Failed again! Step', existingLearning.step, '- will review after', existingLearning.cardsUntilReview, 'cards');
        } else {
          // First failure - add to learning queue
          learningQueueRef.current.push({
            word: currentWord,
            item: currentItem,
            step: 0,
            cardsUntilReview: 5, // Show again after 5 cards
          });
          console.log('[QUIZ] ❌ Failed! Added to learning queue - will review after 5 cards');
        }
      }

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
      // Cancel any pending auto-advance to prevent race conditions
      if (advanceTimeoutRef.current) {
        clearTimeout(advanceTimeoutRef.current);
        advanceTimeoutRef.current = null;
      }

      advanceTimeoutRef.current = setTimeout(() => {
        advanceTimeoutRef.current = null; // Clear ref once timeout fires
        const advanceToNext = async () => {
          console.log('[QUIZ] ⏭️ Auto-advancing - clearing feedback');

          // FIX 1: Calculate learning queue insertions BEFORE advancing to prevent card flashing
          // ANKI-STYLE: Decrement learning queue counters and insert due cards
          const newQuiz = [...quiz];
          const dueCards = [];

          learningQueueRef.current = learningQueueRef.current.map(learningCard => {
            learningCard.cardsUntilReview--;
            if (learningCard.cardsUntilReview <= 0) {
              dueCards.push(learningCard);
              return null; // Remove from learning queue
            }
            return learningCard;
          }).filter(Boolean); // Remove nulls

          // Insert due learning cards right after current position
          // This ensures they appear soon, even if we only have a few cards left
          if (dueCards.length > 0) {
            console.log('[QUIZ] 🔄 Re-inserting', dueCards.length, 'learning cards after position', currentIndex);
            // Insert right after current card so they come up next
            const insertPosition = currentIndex + 1;
            dueCards.forEach((learningCard, i) => {
              newQuiz.splice(insertPosition + i, 0, learningCard.item);
            });
            setQuiz(newQuiz);
          }

          // Find next unanswered question in the quiz array
          let nextIndex = currentIndex + 1;
          while (nextIndex < newQuiz.length && answeredInSessionRef.current.has(newQuiz[nextIndex].word)) {
            console.log('[QUIZ] ⏩ Skipping already answered:', newQuiz[nextIndex].word);
            nextIndex++;
          }

          if (nextIndex < newQuiz.length) {
            console.log('[QUIZ] ⏭️ Moving to next question:', nextIndex);

            // Clear feedback AFTER calculating next index to prevent flashing
            setFeedbackMessage(null);
            setCurrentIndex(nextIndex);

            // Auto-play audio for next question in audio mode
            if (quizMode === 'audio') {
              setTimeout(() => {
                speakChinese(newQuiz[nextIndex].word);
              }, 300);
            }
          } else {
            // End of current batch - check if there are learning cards left
            if (learningQueueRef.current.length > 0) {
              console.log('[QUIZ] 📚 Still', learningQueueRef.current.length, 'cards in learning queue - loading more');
              // Load more questions to create space for learning cards
              const hasMore = await loadNextBatch();
              if (!hasMore && learningQueueRef.current.length > 0) {
                // No more new cards but still have learning cards - force insert them
                console.log('[QUIZ] ⚠️ No more new cards - force inserting remaining learning cards');
                const remainingLearning = learningQueueRef.current.map(l => l.item);
                setQuiz([...newQuiz, ...remainingLearning]);
                learningQueueRef.current = []; // Clear learning queue
                setFeedbackMessage(null);
                setCurrentIndex(currentIndex + 1);
                return;
              }
            }

            // Try to load more questions
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
                setFeedbackMessage(null);
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
              // FIX 2: Check learning queue before showing "all caught up"
              if (learningQueueRef.current.length > 0) {
                // Still have learning cards - don't finish yet
                console.log('[QUIZ] ⚠️ Still have learning cards, continuing...');
                return;
              }
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

      // ANKI-STYLE FILTERING: Only show due/overdue items
      const now = Date.now();
      const today = new Date().setHours(23, 59, 59, 999);
      const todayStart = new Date().setHours(0, 0, 0, 0);

      // Categorize items by review status
      const dueItems = quizItems.filter(item => {
        const quizData = item.quizData;

        // New items (never reviewed)
        if (!quizData || !quizData.nextReview) {
          return true;
        }

        const nextReview = quizData.nextReview;
        const lastReviewed = quizData.lastReviewed;

        // Already reviewed today - skip
        if (lastReviewed && lastReviewed >= todayStart) {
          return false;
        }

        // Overdue or due today
        if (nextReview <= today) {
          return true;
        }

        // Future review - skip
        return false;
      });

      // Filter out items already in current quiz array
      const currentWords = quiz.map(item => item.word);
      const eligibleItems = dueItems.filter(item => !currentWords.includes(item.word));

      // Count types in each stage
      const quizCharCount = quizItems.filter(i => i.type === 'character').length;
      const quizCompCount = quizItems.filter(i => i.type === 'compound').length;
      const dueCharCount = dueItems.filter(i => i.type === 'character').length;
      const dueCompCount = dueItems.filter(i => i.type === 'compound').length;
      const eligCharCount = eligibleItems.filter(i => i.type === 'character').length;
      const eligCompCount = eligibleItems.filter(i => i.type === 'compound').length;

      console.log('[QUIZ] 🔍 Anki filtering breakdown:', {
        total: quizItems.length,
        totalBreakdown: `${quizCharCount} chars + ${quizCompCount} compounds`,
        dueItems: dueItems.length,
        dueBreakdown: `${dueCharCount} chars + ${dueCompCount} compounds`,
        eligible: eligibleItems.length,
        eligibleBreakdown: `${eligCharCount} chars + ${eligCompCount} compounds`,
        currentQuizSize: quiz.length
      });

      // ALWAYS use eligibleItems (never show words already in quiz)
      if (eligibleItems.length === 0) {
        console.log('[QUIZ] ✅ No more due items available - all caught up!');

        // Finish quiz with current score - user has completed all reviews
        Alert.alert(
          '🎉 All Reviews Complete!',
          `Excellent work! You've finished all your reviews for today.\n\n` +
          `Come back tomorrow for more practice!`,
          [{ text: 'Done', onPress: () => {
            // TODO: Navigate back to home or show completion screen
          }}]
        );
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

      // If sentence quiz, submit results to API
      if (quizMode === 'sentences' && progressData.sentenceResults && progressData.sentenceResults.length > 0) {
        try {
          // Group results by character and senseId
          const groupedResults = {};
          progressData.sentenceResults.forEach(result => {
            const key = `${result.character}-${result.senseId}`;
            if (!groupedResults[key]) {
              groupedResults[key] = {
                character: result.character,
                senseId: result.senseId,
                results: []
              };
            }
            groupedResults[key].results.push({
              sentenceId: result.sentenceId,
              correct: result.correct
            });
          });

          // Submit each group to the API
          for (const key in groupedResults) {
            const group = groupedResults[key];
            try {
              await api.recordPracticeSession(group.character, group.senseId, group.results);
              console.log('[QUIZ] Submitted sentence results for', group.character, 'sense', group.senseId);
            } catch (error) {
              console.error('[QUIZ] Error submitting sentence results:', error);
            }
          }

          // Clear sentence results after submission
          progressData.sentenceResults = [];
        } catch (error) {
          console.error('[QUIZ] Error processing sentence results:', error);
        }
      }

      await AsyncStorage.setItem('@progress', JSON.stringify(progressData));
      console.log('[QUIZ] Saved quiz session with statistics');
    } catch (error) {
      console.error('[QUIZ] Error saving quiz session:', error);
    }

    const retryAction = quizMode === 'sentences' ? startSentenceQuiz :
                       quizMode === 'audio' ? startAudioQuiz :
                       startWordQuiz;

    Alert.alert(
      'Quiz Complete! 🎉',
      `You got ${finalScore} out of ${finalTotal} correct (${percentage}%)`,
      [
        { text: 'Try Again', onPress: retryAction },
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
            style={styles.modeButton}
            onPress={() => startSentenceQuiz()}
          >
            <Text style={styles.modeIcon}>💬</Text>
            <Text style={styles.modeTitle}>Sentence Quiz</Text>
            <Text style={styles.modeDesc}>Practice with example sentences</Text>
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
  const direction = quizMode === 'sentences' ? 'chinese-to-english' : getQuizDirection(currentItem.quizData);
  const isReversed = direction === 'english-to-chinese';
  const isAudioMode = quizMode === 'audio';
  const isSentenceMode = quizMode === 'sentences';

  console.log('[QUIZ] 🎯 Rendering quiz for:', currentItem.word || currentItem.chinese, '- mode:', quizMode, 'direction:', direction);

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
          {isSentenceMode && <Text style={styles.modeBadge}>💬</Text>}
          {!isAudioMode && !isSentenceMode && isReversed && <Text style={styles.modeBadge}>🔥</Text>}
        </View>
      </View>

      {/* Main content area - no ScrollView, fixed layout */}
      <View style={styles.contentArea}>
        {/* Quiz Card */}
        <View style={styles.quizCard}>
        {isSentenceMode ? (
          <>
            {/* Sentence Mode: Show Chinese sentence, recall English */}
            <View style={styles.sentenceHeader}>
              <Text style={styles.characterBadge}>{currentItem.character}</Text>
              <Text style={styles.senseMeaning}>{currentItem.senseMeaning}</Text>
            </View>
            <View style={styles.wordWithSpeaker}>
              <Text style={styles.sentenceChinese}>{currentItem.chinese}</Text>
              <TouchableOpacity
                style={styles.speakerButton}
                onPress={() => speakChinese(currentItem.chinese)}
              >
                <Text style={styles.speakerIcon}>🔊</Text>
              </TouchableOpacity>
            </View>
            {currentItem.pinyin && (
              <Text style={styles.quizPinyin}>{currentItem.pinyin}</Text>
            )}

            {revealed && (
              <View style={styles.meaningContainer}>
                <Text style={styles.meaningLabel}>Translation:</Text>
                <Text style={styles.sentenceEnglish}>{currentItem.english}</Text>
              </View>
            )}
          </>
        ) : isAudioMode ? (
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
});

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
  sentenceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    gap: 12,
  },
  characterBadge: {
    fontSize: 32,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  senseMeaning: {
    fontSize: 16,
    color: COLORS.textMedium,
    fontStyle: 'italic',
  },
  sentenceChinese: {
    fontSize: 26,
    color: COLORS.textDark,
    textAlign: 'center',
    lineHeight: 38,
    fontWeight: '500',
  },
  sentenceEnglish: {
    fontSize: 18,
    color: COLORS.textDark,
    textAlign: 'center',
    lineHeight: 27,
    marginTop: 8,
  },
});

export default QuizScreen;
