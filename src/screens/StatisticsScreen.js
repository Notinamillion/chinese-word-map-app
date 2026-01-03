import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '../services/api';
import syncManager from '../services/syncManager';
import { COLORS } from '../theme/colors';

export default function StatisticsScreen() {
  const [progressData, setProgressData] = useState(null);
  const [stats, setStats] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('overview'); // overview | activity | words
  const [syncStatus, setSyncStatus] = useState('loading'); // loading | synced | pending | error

  useEffect(() => {
    loadStatistics();
  }, []);

  const loadStatistics = async () => {
    try {
      // ALWAYS use cached data first (local is source of truth)
      let data = null;
      const cachedProgress = await AsyncStorage.getItem('@progress');
      if (cachedProgress) {
        data = JSON.parse(cachedProgress);
        console.log('[STATS] Loaded from local cache');

        // Check sync status
        const queueSize = syncManager.getQueueSize();
        const isOnline = syncManager.getOnlineStatus();

        if (queueSize > 0) {
          setSyncStatus('pending'); // Has unsyncedchanges
          console.log('[STATS] Sync pending:', queueSize, 'actions in queue');
        } else if (isOnline) {
          setSyncStatus('synced'); // All synced
          console.log('[STATS] All synced');
        } else {
          setSyncStatus('offline'); // Offline but no pending changes
          console.log('[STATS] Offline');
        }
      } else {
        // Only fetch from server if no local data
        try {
          const result = await api.getProgress();
          if (result && typeof result === 'object') {
            data = result;
            await AsyncStorage.setItem('@progress', JSON.stringify(data));
            setSyncStatus('synced');
            console.log('[STATS] Loaded from server (no local cache)');
          }
        } catch (error) {
          setSyncStatus('error');
          console.log('[STATS] Server error and no cache:', error.message);
        }
      }

      if (!data) {
        data = { characterProgress: {}, compoundProgress: {}, statistics: null };
      }

      // Initialize statistics structure if missing
      if (!data.statistics) {
        data.statistics = {
          quizSessions: [],
          dailyStats: {},
          milestones: {
            totalSessions: 0,
            totalReviews: 0,
            currentStreak: 0,
            longestStreak: 0,
            firstQuizDate: null,
          },
        };
      }

      setProgressData(data);
      const calculatedStats = calculateStatistics(data);
      setStats(calculatedStats);
    } catch (error) {
      console.error('[STATS] Error loading statistics:', error);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadStatistics();
    setRefreshing(false);
  };

  // Port of website's calculateStatistics function
  const calculateStatistics = (data) => {
    const stats = {
      totalLearned: 0,
      mastered: 0,
      struggling: 0,
      learning: 0,
      good: 0,
      totalCorrect: 0,
      totalAttempts: 0,
      dueToday: 0,
      dueThisWeek: 0,
      dueLater: 0,
      wordsByCategory: {
        struggling: [],
        learning: [],
        good: [],
        mastered: [],
      },
    };

    const now = Date.now();
    const today = new Date().setHours(23, 59, 59, 999);
    const weekFromNow = today + 7 * 24 * 60 * 60 * 1000;

    // Analyze compound progress
    if (data.compoundProgress) {
      for (const char in data.compoundProgress) {
        const charProgress = data.compoundProgress[char];
        if (charProgress.quizScores) {
          for (const word in charProgress.quizScores) {
            const quizData = charProgress.quizScores[word];
            stats.totalLearned++;

            // Count by score (0-5 scale)
            if (quizData.score === 5) {
              stats.mastered++;
              stats.wordsByCategory.mastered.push({ word, char, ...quizData });
            } else if (quizData.score >= 4) {
              stats.good++;
              stats.wordsByCategory.good.push({ word, char, ...quizData });
            } else if (quizData.score >= 2) {
              stats.learning++;
              stats.wordsByCategory.learning.push({ word, char, ...quizData });
            } else {
              stats.struggling++;
              stats.wordsByCategory.struggling.push({ word, char, ...quizData });
            }

            // Track accuracy
            stats.totalAttempts += quizData.attempts || 0;
            stats.totalCorrect += quizData.correct || 0;

            // Review schedule
            if (quizData.nextReview) {
              if (quizData.nextReview <= now) {
                stats.dueToday++;
              } else if (quizData.nextReview <= weekFromNow) {
                stats.dueThisWeek++;
              } else {
                stats.dueLater++;
              }
            }
          }
        }
      }
    }

    // Analyze character progress
    if (data.characterProgress) {
      for (const char in data.characterProgress) {
        const charData = data.characterProgress[char];
        if (charData.quizScore) {
          const quizData = charData.quizScore;
          stats.totalLearned++;

          if (quizData.score === 5) {
            stats.mastered++;
            stats.wordsByCategory.mastered.push({ word: char, char, ...quizData });
          } else if (quizData.score >= 4) {
            stats.good++;
            stats.wordsByCategory.good.push({ word: char, char, ...quizData });
          } else if (quizData.score >= 2) {
            stats.learning++;
            stats.wordsByCategory.learning.push({ word: char, char, ...quizData });
          } else {
            stats.struggling++;
            stats.wordsByCategory.struggling.push({ word: char, char, ...quizData });
          }

          stats.totalAttempts += quizData.attempts || 0;
          stats.totalCorrect += quizData.correct || 0;

          if (quizData.nextReview) {
            if (quizData.nextReview <= now) {
              stats.dueToday++;
            } else if (quizData.nextReview <= weekFromNow) {
              stats.dueThisWeek++;
            } else {
              stats.dueLater++;
            }
          }
        }
      }
    }

    return stats;
  };

  // Get items due for review (Anki-style)
  const getDueItems = () => {
    if (!progressData) return { overdue: [], dueToday: [], newItems: [] };

    const now = Date.now();
    const today = new Date().setHours(23, 59, 59, 999);
    const todayStart = new Date().setHours(0, 0, 0, 0);
    const overdue = [];
    const dueToday = [];
    const newItems = [];

    // Check character progress
    if (progressData.characterProgress) {
      Object.keys(progressData.characterProgress).forEach(char => {
        const charData = progressData.characterProgress[char];

        // New items (marked as known but never quizzed)
        if (charData?.known && !charData?.quizScore) {
          newItems.push({
            word: char,
            type: 'character',
            isNew: true
          });
          return;
        }

        if (charData?.quizScore?.nextReview) {
          const quizData = charData.quizScore;
          const lastReviewed = quizData.lastReviewed;
          const nextReview = quizData.nextReview;

          // Skip if already reviewed today
          if (lastReviewed && lastReviewed >= todayStart) {
            return;
          }

          // Overdue
          if (nextReview < now) {
            const daysOverdue = Math.floor((now - nextReview) / (24 * 60 * 60 * 1000));
            overdue.push({
              word: char,
              type: 'character',
              daysOverdue,
              score: quizData.score,
              nextReview
            });
          }
          // Due today
          else if (nextReview <= today) {
            dueToday.push({
              word: char,
              type: 'character',
              score: quizData.score,
              nextReview
            });
          }
        }
      });
    }

    // Check compound progress
    if (progressData.compoundProgress) {
      Object.keys(progressData.compoundProgress).forEach(char => {
        const charProgress = progressData.compoundProgress[char];

        // New compound words (marked as known but never quizzed)
        if (charProgress?.known && Array.isArray(charProgress.known)) {
          charProgress.known.forEach(word => {
            // Check if this word has been quizzed
            if (!charProgress.quizScores || !charProgress.quizScores[word]) {
              newItems.push({
                word,
                type: 'compound',
                isNew: true
              });
            }
          });
        }

        if (charProgress?.quizScores) {
          Object.keys(charProgress.quizScores).forEach(word => {
            const quizData = charProgress.quizScores[word];
            if (quizData?.nextReview) {
              const lastReviewed = quizData.lastReviewed;
              const nextReview = quizData.nextReview;

              // Skip if already reviewed today
              if (lastReviewed && lastReviewed >= todayStart) {
                return;
              }

              // Overdue
              if (nextReview < now) {
                const daysOverdue = Math.floor((now - nextReview) / (24 * 60 * 60 * 1000));
                overdue.push({
                  word,
                  type: 'compound',
                  daysOverdue,
                  score: quizData.score,
                  nextReview
                });
              }
              // Due today
              else if (nextReview <= today) {
                dueToday.push({
                  word,
                  type: 'compound',
                  score: quizData.score,
                  nextReview
                });
              }
            }
          });
        }
      });
    }

    // Sort by most overdue first
    overdue.sort((a, b) => b.daysOverdue - a.daysOverdue);
    dueToday.sort((a, b) => a.nextReview - b.nextReview);

    return { overdue, dueToday, newItems };
  };

  // Port of website's getRecentActivity function
  const getRecentActivity = (days = 7) => {
    if (!progressData?.statistics?.dailyStats) {
      return [];
    }

    const activity = [];
    const today = new Date();

    for (let i = 0; i < days; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      const dayStats = progressData.statistics.dailyStats[dateStr];
      if (dayStats) {
        activity.push({
          date: dateStr,
          ...dayStats,
        });
      }
    }

    return activity;
  };

  if (!stats) {
    return (
      <View style={styles.centered}>
        <Text>Loading statistics...</Text>
      </View>
    );
  }

  const accuracy =
    stats.totalAttempts > 0
      ? Math.round((stats.totalCorrect / stats.totalAttempts) * 100)
      : 0;
  const streak = progressData?.statistics?.milestones?.currentStreak || 0;
  const longestStreak = progressData?.statistics?.milestones?.longestStreak || 0;

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>📊 Statistics</Text>
        <Text style={styles.subtitle}>Track your learning progress</Text>
        {/* Sync Status Indicator */}
        {syncStatus === 'pending' && (
          <View style={styles.syncBadge}>
            <Text style={styles.syncText}>⏳ Sync pending</Text>
          </View>
        )}
        {syncStatus === 'synced' && (
          <View style={[styles.syncBadge, styles.syncBadgeSynced]}>
            <Text style={[styles.syncText, styles.syncTextSynced]}>✓ Synced</Text>
          </View>
        )}
        {syncStatus === 'offline' && (
          <View style={[styles.syncBadge, styles.syncBadgeOffline]}>
            <Text style={styles.syncText}>📡 Offline</Text>
          </View>
        )}
        {syncStatus === 'error' && (
          <View style={[styles.syncBadge, styles.syncBadgeError]}>
            <Text style={styles.syncText}>⚠️ Sync error</Text>
          </View>
        )}
      </View>

      {/* Summary Cards */}
      <View style={styles.summaryContainer}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryNumber}>{stats.totalLearned}</Text>
          <Text style={styles.summaryLabel}>Total Learned</Text>
        </View>

        <View style={styles.summaryCard}>
          <Text style={[styles.summaryNumber, { color: '#4caf50' }]}>
            {stats.mastered}
          </Text>
          <Text style={styles.summaryLabel}>Mastered</Text>
        </View>

        <View style={styles.summaryCard}>
          <Text style={[styles.summaryNumber, { color: '#2196F3' }]}>
            {accuracy}%
          </Text>
          <Text style={styles.summaryLabel}>Accuracy</Text>
        </View>

        <View style={styles.summaryCard}>
          <Text style={[styles.summaryNumber, { color: '#ff9800' }]}>
            {streak}
          </Text>
          <Text style={styles.summaryLabel}>Day Streak</Text>
        </View>
      </View>

      {/* Due Today Section */}
      {(() => {
        const { overdue, dueToday, newItems } = getDueItems();
        const totalDue = overdue.length + dueToday.length;
        const totalNew = newItems.length;

        // Show section if there are reviews OR new items
        if (totalDue === 0 && totalNew === 0) {
          return (
            <View style={styles.dueSection}>
              <Text style={styles.dueSectionTitle}>🎉 All Caught Up!</Text>
              <Text style={styles.allCaughtUpText}>
                No reviews or new items available!
              </Text>
            </View>
          );
        }

        return (
          <View style={styles.dueSection}>
            {totalDue > 0 && (
              <Text style={styles.dueSectionTitle}>
                📋 Reviews Due Today ({totalDue})
              </Text>
            )}
            {totalDue === 0 && totalNew > 0 && (
              <Text style={styles.dueSectionTitle}>
                📚 Ready to Learn
              </Text>
            )}

            {overdue.length > 0 && (
              <View style={styles.dueCategory}>
                <Text style={styles.dueCategoryTitle}>
                  🔴 Overdue ({overdue.length})
                </Text>
                {overdue.slice(0, 5).map((item, idx) => (
                  <View key={idx} style={styles.dueItem}>
                    <Text style={styles.dueWord}>{item.word}</Text>
                    <Text style={styles.dueInfo}>
                      {item.daysOverdue} {item.daysOverdue === 1 ? 'day' : 'days'} overdue
                    </Text>
                  </View>
                ))}
                {overdue.length > 5 && (
                  <Text style={styles.moreItems}>
                    ... and {overdue.length - 5} more
                  </Text>
                )}
              </View>
            )}

            {dueToday.length > 0 && (
              <View style={styles.dueCategory}>
                <Text style={styles.dueCategoryTitle}>
                  🟡 Due Today ({dueToday.length})
                </Text>
                {dueToday.slice(0, 5).map((item, idx) => (
                  <View key={idx} style={styles.dueItem}>
                    <Text style={styles.dueWord}>{item.word}</Text>
                    <Text style={styles.dueInfo}>Score: {item.score}/5</Text>
                  </View>
                ))}
                {dueToday.length > 5 && (
                  <Text style={styles.moreItems}>
                    ... and {dueToday.length - 5} more
                  </Text>
                )}
              </View>
            )}

            {newItems.length > 0 && (
              <View style={styles.dueCategory}>
                <Text style={styles.dueCategoryTitle}>
                  🆕 New Items ({newItems.length})
                </Text>
                <Text style={styles.newItemsSubtext}>
                  {newItems.filter(i => i.type === 'character').length} characters + {newItems.filter(i => i.type === 'compound').length} compounds
                </Text>
                {newItems.slice(0, 5).map((item, idx) => (
                  <View key={idx} style={styles.dueItem}>
                    <Text style={styles.dueWord}>{item.word}</Text>
                    <Text style={styles.dueInfo}>{item.type}</Text>
                  </View>
                ))}
                {newItems.length > 5 && (
                  <Text style={styles.moreItems}>
                    ... and {newItems.length - 5} more
                  </Text>
                )}
              </View>
            )}

            <TouchableOpacity
              style={styles.startReviewButton}
              onPress={() => {
                // Navigate to Quiz screen
                // TODO: Add navigation
                console.log('[STATS] Start review button pressed');
              }}
            >
              <Text style={styles.startReviewButtonText}>
                {totalDue > 0 ? `Start Review (${totalDue} due)` : `Learn New Items (${totalNew})`}
              </Text>
            </TouchableOpacity>
          </View>
        );
      })()}

      {/* Tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'overview' && styles.tabActive]}
          onPress={() => setActiveTab('overview')}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === 'overview' && styles.tabTextActive,
            ]}
          >
            Overview
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === 'activity' && styles.tabActive]}
          onPress={() => setActiveTab('activity')}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === 'activity' && styles.tabTextActive,
            ]}
          >
            Activity
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === 'words' && styles.tabActive]}
          onPress={() => setActiveTab('words')}
        >
          <Text
            style={[styles.tabText, activeTab === 'words' && styles.tabTextActive]}
          >
            Words
          </Text>
        </TouchableOpacity>
      </View>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <View>
          {/* Progress Distribution */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Progress Distribution</Text>
            {renderProgressDistribution(stats)}
          </View>

          {/* Review Schedule */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Review Schedule</Text>
            {renderReviewSchedule(stats)}
          </View>

          {/* Milestones */}
          {progressData?.statistics?.milestones && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Milestones</Text>
              <View style={styles.milestoneContainer}>
                <View style={styles.milestoneItem}>
                  <Text style={styles.milestoneIcon}>🏆</Text>
                  <Text style={styles.milestoneLabel}>Longest Streak</Text>
                  <Text style={styles.milestoneValue}>{longestStreak} days</Text>
                </View>
                <View style={styles.milestoneItem}>
                  <Text style={styles.milestoneIcon}>🎯</Text>
                  <Text style={styles.milestoneLabel}>Total Quizzes</Text>
                  <Text style={styles.milestoneValue}>
                    {progressData.statistics.milestones.totalSessions || 0}
                  </Text>
                </View>
                <View style={styles.milestoneItem}>
                  <Text style={styles.milestoneIcon}>📚</Text>
                  <Text style={styles.milestoneLabel}>Total Reviews</Text>
                  <Text style={styles.milestoneValue}>
                    {progressData.statistics.milestones.totalReviews || 0}
                  </Text>
                </View>
              </View>
            </View>
          )}
        </View>
      )}

      {activeTab === 'activity' && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Activity (Last 7 Days)</Text>
          {renderRecentActivity()}
        </View>
      )}

      {activeTab === 'words' && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Words by Category</Text>
          {renderWordsList(stats)}
        </View>
      )}
    </ScrollView>
  );

  // Render functions
  function renderProgressDistribution(stats) {
    const total = stats.totalLearned || 1;
    const strugglingPercent = (stats.struggling / total) * 100;
    const learningPercent = (stats.learning / total) * 100;
    const goodPercent = (stats.good / total) * 100;
    const masteredPercent = (stats.mastered / total) * 100;

    if (total === 0 || stats.totalLearned === 0) {
      return (
        <Text style={styles.emptyState}>
          No quiz data yet. Start taking quizzes to see your progress!
        </Text>
      );
    }

    return (
      <View>
        <ProgressBar
          label="Struggling"
          count={stats.struggling}
          percent={strugglingPercent}
          color="#f44336"
        />
        <ProgressBar
          label="Learning"
          count={stats.learning}
          percent={learningPercent}
          color="#ff9800"
        />
        <ProgressBar
          label="Good"
          count={stats.good}
          percent={goodPercent}
          color="#2196F3"
        />
        <ProgressBar
          label="Mastered"
          count={stats.mastered}
          percent={masteredPercent}
          color="#4caf50"
        />
      </View>
    );
  }

  function renderReviewSchedule(stats) {
    const total = stats.dueToday + stats.dueThisWeek + stats.dueLater;

    if (total === 0) {
      return (
        <Text style={styles.emptyState}>
          No reviews scheduled. Words will appear here as you quiz them!
        </Text>
      );
    }

    return (
      <View>
        <ReviewItem
          label="Due Today"
          count={stats.dueToday}
          icon="🔴"
          color="#f44336"
        />
        <ReviewItem
          label="Due This Week"
          count={stats.dueThisWeek}
          icon="🟡"
          color="#ff9800"
        />
        <ReviewItem
          label="Due Later"
          count={stats.dueLater}
          icon="🟢"
          color="#4caf50"
        />
      </View>
    );
  }

  function renderRecentActivity() {
    const activity = getRecentActivity(7);

    if (activity.length === 0) {
      return (
        <Text style={styles.emptyState}>
          No recent activity. Start taking quizzes to see your progress!
        </Text>
      );
    }

    return (
      <View>
        {activity.map((day, index) => {
          const date = new Date(day.date);
          const formattedDate = date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            weekday: 'short',
          });

          const dayAccuracy = Math.round(day.accuracy * 100);
          const timeSpent = day.timeSpent
            ? Math.round(day.timeSpent / 60000)
            : 0;

          return (
            <View key={index} style={styles.activityDay}>
              <Text style={styles.activityDate}>{formattedDate}</Text>
              <View style={styles.activityStats}>
                <Text style={styles.activityStat}>
                  📝 {day.itemsReviewed} reviewed
                </Text>
                <Text style={styles.activityStat}>🎯 {dayAccuracy}% correct</Text>
                <Text style={styles.activityStat}>⏱️ {timeSpent} min</Text>
              </View>
            </View>
          );
        })}
      </View>
    );
  }

  function renderWordsList(stats) {
    return (
      <View>
        <WordCategory
          title="Mastered (5/5)"
          words={stats.wordsByCategory.mastered}
          color="#4caf50"
        />
        <WordCategory
          title="Good (4/5)"
          words={stats.wordsByCategory.good}
          color="#2196F3"
        />
        <WordCategory
          title="Learning (2-3/5)"
          words={stats.wordsByCategory.learning}
          color="#ff9800"
        />
        <WordCategory
          title="Struggling (0-1/5)"
          words={stats.wordsByCategory.struggling}
          color="#f44336"
        />
      </View>
    );
  }
}

// Helper Components
function ProgressBar({ label, count, percent, color }) {
  return (
    <View style={styles.progressBarContainer}>
      <View style={styles.progressBarHeader}>
        <Text style={styles.progressBarLabel}>{label}</Text>
        <Text style={styles.progressBarCount}>
          {count} ({Math.round(percent)}%)
        </Text>
      </View>
      <View style={styles.progressBarTrack}>
        <View
          style={[
            styles.progressBarFill,
            { width: `${percent}%`, backgroundColor: color },
          ]}
        />
      </View>
    </View>
  );
}

function ReviewItem({ label, count, icon, color }) {
  return (
    <View style={styles.reviewItem}>
      <Text style={styles.reviewIcon}>{icon}</Text>
      <Text style={styles.reviewLabel}>{label}</Text>
      <Text style={[styles.reviewCount, { color }]}>{count}</Text>
    </View>
  );
}

function WordCategory({ title, words, color }) {
  const [expanded, setExpanded] = React.useState(false);

  if (words.length === 0) {
    return null;
  }

  return (
    <View style={styles.categoryContainer}>
      <TouchableOpacity
        style={styles.categoryHeader}
        onPress={() => setExpanded(!expanded)}
      >
        <View style={styles.categoryTitleRow}>
          <View style={[styles.categoryDot, { backgroundColor: color }]} />
          <Text style={styles.categoryTitle}>{title}</Text>
          <Text style={styles.categoryCount}>({words.length})</Text>
        </View>
        <Text style={styles.categoryArrow}>{expanded ? '▼' : '▶'}</Text>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.categoryWords}>
          {words.slice(0, 20).map((item, index) => (
            <View key={index} style={styles.wordItem}>
              <Text style={styles.wordText}>{item.word}</Text>
              <Text style={styles.wordStats}>
                {item.correct || 0}/{item.attempts || 0} (
                {item.score !== undefined ? item.score : 0}/5)
              </Text>
            </View>
          ))}
          {words.length > 20 && (
            <Text style={styles.moreWords}>
              ... and {words.length - 20} more
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

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
  header: {
    backgroundColor: COLORS.primary,
    padding: 30,
    alignItems: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: COLORS.white,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.white,
    opacity: 0.9,
  },
  summaryContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 10,
    gap: 10,
  },
  summaryCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: COLORS.white,
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    borderWidth: 1,
    borderColor: COLORS.primaryLight,
  },
  summaryNumber: {
    fontSize: 32,
    fontWeight: 'bold',
    color: COLORS.primary,
    marginBottom: 8,
  },
  summaryLabel: {
    fontSize: 14,
    color: COLORS.textMedium,
    fontWeight: '600',
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: COLORS.white,
    marginHorizontal: 20,
    marginTop: 10,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.primaryLight,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: COLORS.primary,
    backgroundColor: COLORS.primaryLight,
  },
  tabText: {
    fontSize: 14,
    color: COLORS.textMedium,
    fontWeight: '600',
  },
  tabTextActive: {
    color: COLORS.primary,
    fontWeight: '700',
  },
  section: {
    backgroundColor: COLORS.white,
    margin: 20,
    padding: 20,
    borderRadius: 12,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    borderWidth: 1,
    borderColor: COLORS.primaryLight,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.textDark,
    marginBottom: 16,
  },
  emptyState: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    fontStyle: 'italic',
    paddingVertical: 20,
  },
  progressBarContainer: {
    marginBottom: 16,
  },
  progressBarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  progressBarLabel: {
    fontSize: 14,
    color: COLORS.textDark,
    fontWeight: '600',
  },
  progressBarCount: {
    fontSize: 14,
    color: COLORS.textMedium,
  },
  progressBarTrack: {
    height: 10,
    backgroundColor: COLORS.mediumGray,
    borderRadius: 5,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 5,
  },
  reviewItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.primaryLight,
  },
  reviewIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  reviewLabel: {
    flex: 1,
    fontSize: 16,
    color: COLORS.textDark,
  },
  reviewCount: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  activityDay: {
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  activityDate: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  activityStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  activityStat: {
    fontSize: 14,
    color: '#666',
  },
  milestoneContainer: {
    gap: 12,
  },
  milestoneItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  milestoneIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  milestoneLabel: {
    flex: 1,
    fontSize: 16,
    color: '#333',
  },
  milestoneValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#667eea',
  },
  categoryContainer: {
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    overflow: 'hidden',
  },
  categoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#f9f9f9',
  },
  categoryTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  categoryDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  categoryTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  categoryCount: {
    fontSize: 14,
    color: '#666',
    marginLeft: 4,
  },
  categoryArrow: {
    fontSize: 12,
    color: '#666',
  },
  categoryWords: {
    padding: 12,
    backgroundColor: '#fff',
  },
  wordItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  wordText: {
    fontSize: 18,
    color: '#333',
  },
  wordStats: {
    fontSize: 14,
    color: '#666',
  },
  moreWords: {
    fontSize: 14,
    color: '#999',
    fontStyle: 'italic',
    textAlign: 'center',
    paddingTop: 12,
  },
  syncBadge: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: COLORS.primaryYellow,
    alignSelf: 'center',
  },
  syncBadgeSynced: {
    backgroundColor: COLORS.success,
  },
  syncBadgeOffline: {
    backgroundColor: COLORS.textMedium,
  },
  syncBadgeError: {
    backgroundColor: COLORS.error,
  },
  syncText: {
    fontSize: 12,
    color: COLORS.white,
    fontWeight: '600',
  },
  syncTextSynced: {
    color: COLORS.white,
  },
  dueSection: {
    backgroundColor: COLORS.white,
    margin: 20,
    marginTop: 10,
    padding: 20,
    borderRadius: 12,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    borderWidth: 1,
    borderColor: COLORS.primaryLight,
  },
  dueSectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.textDark,
    marginBottom: 16,
  },
  allCaughtUpText: {
    fontSize: 14,
    color: COLORS.textMedium,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  dueCategory: {
    marginBottom: 16,
  },
  dueCategoryTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textDark,
    marginBottom: 8,
  },
  newItemsSubtext: {
    fontSize: 14,
    color: COLORS.textMedium,
    marginBottom: 8,
    fontStyle: 'italic',
  },
  dueItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: COLORS.lightGray,
    borderRadius: 8,
    marginBottom: 6,
  },
  dueWord: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.textDark,
  },
  dueInfo: {
    fontSize: 14,
    color: COLORS.textMedium,
  },
  moreItems: {
    fontSize: 14,
    color: COLORS.textLight,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 8,
  },
  startReviewButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  startReviewButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: 'bold',
  },
});
