import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS } from '../theme/colors';

const WordStatsScreen = ({ navigation }) => {
  const [allWords, setAllWords] = useState([]);
  const [filteredWords, setFilteredWords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('score'); // 'score', 'interval', 'attempts', 'accuracy'
  const [filterType, setFilterType] = useState('all'); // 'all', 'character', 'compound'

  useEffect(() => {
    loadWordStats();
  }, []);

  useEffect(() => {
    filterAndSortWords();
  }, [searchQuery, sortBy, filterType, allWords]);

  const loadWordStats = async () => {
    try {
      const cachedProgress = await AsyncStorage.getItem('@progress');
      if (!cachedProgress) {
        setLoading(false);
        return;
      }

      const progressData = JSON.parse(cachedProgress);
      const words = [];

      // Load character stats
      if (progressData.characterProgress) {
        for (const char in progressData.characterProgress) {
          const charData = progressData.characterProgress[char];
          if (charData.quizScore) {
            const quizData = charData.quizScore;
            const accuracy = quizData.attempts > 0
              ? ((quizData.correct / quizData.attempts) * 100).toFixed(1)
              : 0;

            words.push({
              word: char,
              type: 'character',
              score: quizData.score || 0,
              interval: quizData.interval || 0,
              easiness: quizData.easiness || 2.5,
              attempts: quizData.attempts || 0,
              correct: quizData.correct || 0,
              accuracy: parseFloat(accuracy),
              lastReviewed: quizData.lastReviewed || null,
              nextReview: quizData.nextReview || null,
              consecutiveCorrect: quizData.consecutiveCorrect || 0,
            });
          }
        }
      }

      // Load compound stats
      if (progressData.compoundProgress) {
        for (const char in progressData.compoundProgress) {
          const charProgress = progressData.compoundProgress[char];
          if (charProgress.quizScores) {
            for (const word in charProgress.quizScores) {
              const quizData = charProgress.quizScores[word];
              if (quizData) {
                const accuracy = quizData.attempts > 0
                  ? ((quizData.correct / quizData.attempts) * 100).toFixed(1)
                  : 0;

                words.push({
                  word: word,
                  type: 'compound',
                  score: quizData.score || 0,
                  interval: quizData.interval || 0,
                  easiness: quizData.easiness || 2.5,
                  attempts: quizData.attempts || 0,
                  correct: quizData.correct || 0,
                  accuracy: parseFloat(accuracy),
                  lastReviewed: quizData.lastReviewed || null,
                  nextReview: quizData.nextReview || null,
                  consecutiveCorrect: quizData.consecutiveCorrect || 0,
                });
              }
            }
          }
        }
      }

      setAllWords(words);
      console.log(`[WORD STATS] Loaded ${words.length} words with stats`);
    } catch (error) {
      console.error('[WORD STATS] Error loading:', error);
    } finally {
      setLoading(false);
    }
  };

  const filterAndSortWords = () => {
    let filtered = [...allWords];

    // Filter by type
    if (filterType !== 'all') {
      filtered = filtered.filter(w => w.type === filterType);
    }

    // Filter by search query
    if (searchQuery) {
      filtered = filtered.filter(w => w.word.includes(searchQuery));
    }

    // Sort
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'score':
          return b.score - a.score;
        case 'interval':
          return b.interval - a.interval;
        case 'attempts':
          return b.attempts - a.attempts;
        case 'accuracy':
          return b.accuracy - a.accuracy;
        default:
          return 0;
      }
    });

    setFilteredWords(filtered);
  };

  const formatNextReview = (timestamp) => {
    if (!timestamp) return 'Not scheduled';

    const now = Date.now();
    const diff = timestamp - now;

    if (diff < 0) return 'Overdue';

    const days = Math.floor(diff / (24 * 60 * 60 * 1000));
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days < 7) return `${days}d`;
    if (days < 30) return `${Math.floor(days / 7)}w`;
    return `${Math.floor(days / 30)}m`;
  };

  const formatLastReview = (timestamp) => {
    if (!timestamp) return 'Never';

    const now = Date.now();
    const diff = now - timestamp;
    const days = Math.floor(diff / (24 * 60 * 60 * 1000));

    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    return `${Math.floor(days / 30)}m ago`;
  };

  const getScoreColor = (score) => {
    if (score >= 5) return '#4CAF50'; // Green
    if (score >= 4) return '#2196F3'; // Blue
    if (score >= 2) return '#FF9800'; // Orange
    return '#F44336'; // Red
  };

  const renderWordItem = ({ item }) => (
    <View style={styles.wordCard}>
      <View style={styles.wordHeader}>
        <View style={styles.wordTitleRow}>
          <Text style={styles.wordText}>{item.word}</Text>
          <Text style={styles.wordType}>{item.type}</Text>
        </View>
        <View style={[styles.scoreBadge, { backgroundColor: getScoreColor(item.score) }]}>
          <Text style={styles.scoreText}>{item.score}/5</Text>
        </View>
      </View>

      <View style={styles.statsGrid}>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Interval</Text>
          <Text style={styles.statValue}>{item.interval}d</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Attempts</Text>
          <Text style={styles.statValue}>{item.attempts}</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Accuracy</Text>
          <Text style={styles.statValue}>{item.accuracy}%</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Easiness</Text>
          <Text style={styles.statValue}>{item.easiness.toFixed(2)}</Text>
        </View>
      </View>

      <View style={styles.reviewInfo}>
        <View style={styles.reviewItem}>
          <Text style={styles.reviewLabel}>Last Reviewed:</Text>
          <Text style={styles.reviewValue}>{formatLastReview(item.lastReviewed)}</Text>
        </View>
        <View style={styles.reviewItem}>
          <Text style={styles.reviewLabel}>Next Review:</Text>
          <Text style={[
            styles.reviewValue,
            item.nextReview && item.nextReview < Date.now() && styles.overdueText
          ]}>
            {formatNextReview(item.nextReview)}
          </Text>
        </View>
      </View>

      <View style={styles.extraInfo}>
        <Text style={styles.extraText}>
          Correct: {item.correct}/{item.attempts} • Streak: {item.consecutiveCorrect}
        </Text>
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading word statistics...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search words..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholderTextColor={COLORS.textLight}
        />
      </View>

      {/* Filter Buttons */}
      <View style={styles.filterRow}>
        <TouchableOpacity
          style={[styles.filterButton, filterType === 'all' && styles.filterButtonActive]}
          onPress={() => setFilterType('all')}
        >
          <Text style={[styles.filterButtonText, filterType === 'all' && styles.filterButtonTextActive]}>
            All ({allWords.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterButton, filterType === 'character' && styles.filterButtonActive]}
          onPress={() => setFilterType('character')}
        >
          <Text style={[styles.filterButtonText, filterType === 'character' && styles.filterButtonTextActive]}>
            Characters ({allWords.filter(w => w.type === 'character').length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterButton, filterType === 'compound' && styles.filterButtonActive]}
          onPress={() => setFilterType('compound')}
        >
          <Text style={[styles.filterButtonText, filterType === 'compound' && styles.filterButtonTextActive]}>
            Compounds ({allWords.filter(w => w.type === 'compound').length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Sort Buttons */}
      <View style={styles.sortRow}>
        <Text style={styles.sortLabel}>Sort by:</Text>
        <TouchableOpacity
          style={[styles.sortButton, sortBy === 'score' && styles.sortButtonActive]}
          onPress={() => setSortBy('score')}
        >
          <Text style={[styles.sortButtonText, sortBy === 'score' && styles.sortButtonTextActive]}>Score</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.sortButton, sortBy === 'interval' && styles.sortButtonActive]}
          onPress={() => setSortBy('interval')}
        >
          <Text style={[styles.sortButtonText, sortBy === 'interval' && styles.sortButtonTextActive]}>Interval</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.sortButton, sortBy === 'attempts' && styles.sortButtonActive]}
          onPress={() => setSortBy('attempts')}
        >
          <Text style={[styles.sortButtonText, sortBy === 'attempts' && styles.sortButtonTextActive]}>Attempts</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.sortButton, sortBy === 'accuracy' && styles.sortButtonActive]}
          onPress={() => setSortBy('accuracy')}
        >
          <Text style={[styles.sortButtonText, sortBy === 'accuracy' && styles.sortButtonTextActive]}>Accuracy</Text>
        </TouchableOpacity>
      </View>

      {/* Results Count */}
      <View style={styles.resultsHeader}>
        <Text style={styles.resultsText}>
          {filteredWords.length} word{filteredWords.length !== 1 ? 's' : ''}
        </Text>
      </View>

      {/* Word List */}
      <FlatList
        data={filteredWords}
        renderItem={renderWordItem}
        keyExtractor={(item, index) => `${item.word}-${item.type}-${index}`}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No words found</Text>
            <Text style={styles.emptySubtext}>Start taking quizzes to see stats here!</Text>
          </View>
        }
      />
    </View>
  );
};

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
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: COLORS.textMedium,
  },
  searchContainer: {
    padding: 15,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.primaryLight,
  },
  searchInput: {
    height: 40,
    borderWidth: 1,
    borderColor: COLORS.primaryLight,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 16,
    color: COLORS.textDark,
  },
  filterRow: {
    flexDirection: 'row',
    padding: 10,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.primaryLight,
    gap: 8,
  },
  filterButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: COLORS.lightGray,
    alignItems: 'center',
  },
  filterButtonActive: {
    backgroundColor: COLORS.primary,
  },
  filterButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textDark,
  },
  filterButtonTextActive: {
    color: COLORS.white,
  },
  sortRow: {
    flexDirection: 'row',
    padding: 10,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.primaryLight,
    alignItems: 'center',
    gap: 8,
  },
  sortLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textDark,
    marginRight: 4,
  },
  sortButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: COLORS.lightGray,
  },
  sortButtonActive: {
    backgroundColor: COLORS.primary,
  },
  sortButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textDark,
  },
  sortButtonTextActive: {
    color: COLORS.white,
  },
  resultsHeader: {
    padding: 10,
    backgroundColor: COLORS.mediumGray,
  },
  resultsText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textMedium,
  },
  listContent: {
    padding: 10,
  },
  wordCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 15,
    marginBottom: 10,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    borderWidth: 1,
    borderColor: COLORS.primaryLight,
  },
  wordHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  wordTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  wordText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.textDark,
  },
  wordType: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textLight,
    backgroundColor: COLORS.mediumGray,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  scoreBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  scoreText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12,
  },
  statItem: {
    flex: 1,
    minWidth: '22%',
    backgroundColor: COLORS.lightGray,
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textLight,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.textDark,
  },
  reviewInfo: {
    marginBottom: 8,
  },
  reviewItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  reviewLabel: {
    fontSize: 13,
    color: COLORS.textMedium,
  },
  reviewValue: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textDark,
  },
  overdueText: {
    color: COLORS.error,
  },
  extraInfo: {
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.primaryLight,
  },
  extraText: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  emptyState: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.textMedium,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: COLORS.textLight,
  },
});

export default WordStatsScreen;
