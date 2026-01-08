import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Share,
} from 'react-native';
import api from '../services/api';

const COLORS = {
  primary: '#2196F3',
  background: '#F5F5F5',
  cardBackground: '#FFFFFF',
  textDark: '#333333',
  textLight: '#666666',
  border: '#E0E0E0',
  success: '#4CAF50',
  error: '#F44336',
  warning: '#FF9800',
};

const QuizHistoryScreen = ({ navigation }) => {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, correct: 0, accuracy: 0 });
  const [filter, setFilter] = useState('all'); // 'all', 'today', 'week'
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    loadHistory();
  }, [filter]);

  const loadHistory = async (loadMore = false) => {
    try {
      const currentPage = loadMore ? page + 1 : 0;
      const limit = 50;
      const offset = currentPage * limit;

      // Calculate date filters
      let startDate = null;
      if (filter === 'today') {
        startDate = new Date().setHours(0, 0, 0, 0);
      } else if (filter === 'week') {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        startDate = weekAgo.getTime();
      }

      const filters = { limit, offset };
      if (startDate) filters.startDate = startDate;

      const response = await api.getQuizHistory(filters);

      if (response.success) {
        const newHistory = loadMore
          ? [...history, ...response.history]
          : response.history;

        setHistory(newHistory);
        setPage(currentPage);
        setHasMore(response.history.length === limit);

        // Calculate stats
        const totalAttempts = response.total;
        const correctAttempts = newHistory.filter(h => h.isCorrect === 1).length;
        const accuracy = totalAttempts > 0 ? (correctAttempts / totalAttempts * 100).toFixed(1) : 0;

        setStats({
          total: totalAttempts,
          correct: correctAttempts,
          accuracy: accuracy,
        });
      }
    } catch (error) {
      console.error('[HISTORY] Error loading history:', error);
      Alert.alert('Error', 'Failed to load quiz history');
    } finally {
      setLoading(false);
    }
  };

  const exportToCSV = async () => {
    try {
      Alert.alert('Export', 'Exporting quiz history...');

      let startDate = null;
      if (filter === 'today') {
        startDate = new Date().setHours(0, 0, 0, 0);
      } else if (filter === 'week') {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        startDate = weekAgo.getTime();
      }

      const filters = {};
      if (startDate) filters.startDate = startDate;

      const blob = await api.exportQuizHistory(filters);

      // Convert blob to base64 for sharing
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = async () => {
        const base64data = reader.result;
        await Share.share({
          message: 'Quiz History Export',
          title: 'quiz-history.csv',
          url: base64data,
        });
      };
    } catch (error) {
      console.error('[HISTORY] Error exporting:', error);
      Alert.alert('Error', 'Failed to export quiz history');
    }
  };

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    const today = new Date().setHours(0, 0, 0, 0);
    const yesterday = new Date(today - 24 * 60 * 60 * 1000);

    if (date >= today) {
      return `Today ${date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
    } else if (date >= yesterday) {
      return `Yesterday ${date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
    } else {
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
  };

  const getQualityColor = (quality) => {
    if (quality >= 4) return COLORS.success;
    if (quality >= 3) return COLORS.warning;
    return COLORS.error;
  };

  const getQualityLabel = (quality) => {
    const labels = { 5: 'Perfect', 4: 'Good', 3: 'OK', 2: 'Hard', 1: 'Very Hard', 0: 'Forgot' };
    return labels[quality] || 'Unknown';
  };

  const renderHistoryItem = ({ item }) => (
    <View style={styles.historyCard}>
      <View style={styles.historyHeader}>
        <Text style={styles.word}>{item.word}</Text>
        <View style={[styles.qualityBadge, { backgroundColor: getQualityColor(item.quality) }]}>
          <Text style={styles.qualityText}>{getQualityLabel(item.quality)}</Text>
        </View>
      </View>

      <View style={styles.historyDetails}>
        <Text style={styles.detailText}>
          {formatDate(item.createdAt)} • {item.quizMode}
        </Text>
        <Text style={styles.detailText}>
          {item.isCorrect === 1 ? '✅ Correct' : '❌ Wrong'}
        </Text>
      </View>

      <View style={styles.sm2Details}>
        <Text style={styles.sm2Text}>
          Interval: {item.intervalBefore}d → {item.intervalAfter}d
        </Text>
        <Text style={styles.sm2Text}>
          Score: {item.scoreBefore} → {item.scoreAfter}
        </Text>
        <Text style={styles.sm2Text}>
          Easiness: {(item.easinessBefore || 0).toFixed(2)} → {(item.easinessAfter || 0).toFixed(2)}
        </Text>
      </View>
    </View>
  );

  const renderHeader = () => (
    <View style={styles.header}>
      <Text style={styles.title}>Quiz History</Text>

      {/* Stats Summary */}
      <View style={styles.statsContainer}>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{stats.total}</Text>
          <Text style={styles.statLabel}>Total</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{stats.correct}</Text>
          <Text style={styles.statLabel}>Correct</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{stats.accuracy}%</Text>
          <Text style={styles.statLabel}>Accuracy</Text>
        </View>
      </View>

      {/* Filter Buttons */}
      <View style={styles.filterContainer}>
        <TouchableOpacity
          style={[styles.filterButton, filter === 'all' && styles.filterButtonActive]}
          onPress={() => setFilter('all')}
        >
          <Text style={[styles.filterText, filter === 'all' && styles.filterTextActive]}>
            All Time
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterButton, filter === 'week' && styles.filterButtonActive]}
          onPress={() => setFilter('week')}
        >
          <Text style={[styles.filterText, filter === 'week' && styles.filterTextActive]}>
            Last 7 Days
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterButton, filter === 'today' && styles.filterButtonActive]}
          onPress={() => setFilter('today')}
        >
          <Text style={[styles.filterText, filter === 'today' && styles.filterTextActive]}>
            Today
          </Text>
        </TouchableOpacity>
      </View>

      {/* Export Button */}
      <TouchableOpacity style={styles.exportButton} onPress={exportToCSV}>
        <Text style={styles.exportButtonText}>📥 Export to CSV</Text>
      </TouchableOpacity>
    </View>
  );

  const renderFooter = () => {
    if (!hasMore) return null;
    return (
      <TouchableOpacity
        style={styles.loadMoreButton}
        onPress={() => loadHistory(true)}
      >
        <Text style={styles.loadMoreText}>Load More</Text>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading quiz history...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={history}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderHistoryItem}
        ListHeaderComponent={renderHeader}
        ListFooterComponent={renderFooter}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No quiz history yet</Text>
            <Text style={styles.emptySubtext}>
              Complete some quiz cards to see your history here
            </Text>
          </View>
        }
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: COLORS.textLight,
  },
  listContent: {
    padding: 16,
  },
  header: {
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.textDark,
    marginBottom: 16,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: COLORS.cardBackground,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  statBox: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  statLabel: {
    fontSize: 14,
    color: COLORS.textLight,
    marginTop: 4,
  },
  filterContainer: {
    flexDirection: 'row',
    marginBottom: 16,
    gap: 8,
  },
  filterButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: COLORS.cardBackground,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  filterButtonActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  filterText: {
    fontSize: 14,
    color: COLORS.textDark,
    fontWeight: '500',
  },
  filterTextActive: {
    color: '#FFFFFF',
  },
  exportButton: {
    backgroundColor: COLORS.success,
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginBottom: 16,
  },
  exportButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  historyCard: {
    backgroundColor: COLORS.cardBackground,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  word: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.textDark,
  },
  qualityBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  qualityText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  historyDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  detailText: {
    fontSize: 14,
    color: COLORS.textLight,
  },
  sm2Details: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  sm2Text: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  loadMoreButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 24,
  },
  loadMoreText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  emptyContainer: {
    alignItems: 'center',
    marginTop: 48,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.textDark,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
  },
});

export default QuizHistoryScreen;
