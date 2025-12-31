import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, StatusBar } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import syncManager from './src/services/syncManager';
import AuthScreen from './src/screens/AuthScreen';
import HomeScreen from './src/screens/HomeScreen';
import CharacterDetailScreen from './src/screens/CharacterDetailScreen';
import QuizScreen from './src/screens/QuizScreen';
import StatisticsScreen from './src/screens/StatisticsScreen';
import { COLORS } from './src/theme/colors';
import HomeIcon from './src/components/icons/HomeIcon';
import QuizIcon from './src/components/icons/QuizIcon';
import StatsIcon from './src/components/icons/StatsIcon';
import ProfileIcon from './src/components/icons/ProfileIcon';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

// Home Stack Navigator
function HomeStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: COLORS.white,
          borderBottomColor: COLORS.primaryLight,
          borderBottomWidth: 1,
        },
        headerTintColor: COLORS.primary,
        headerTitleStyle: {
          fontWeight: '700',
        },
      }}
    >
      <Stack.Screen
        name="HomeList"
        component={HomeScreen}
        options={{ title: 'ZhongMap' }}
      />
      <Stack.Screen
        name="CharacterDetail"
        component={CharacterDetailScreen}
        options={({ route }) => ({
          title: route.params?.character?.char || 'Character'
        })}
      />
    </Stack.Navigator>
  );
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState({ online: true, queueSize: 0 });
  const [dueCardsCount, setDueCardsCount] = useState(0);

  useEffect(() => {
    initializeApp();

    // Update due cards count periodically
    const interval = setInterval(updateDueCardsCount, 60000); // Every minute
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      updateDueCardsCount();
    }
  }, [isAuthenticated]);

  const updateDueCardsCount = async () => {
    try {
      const cachedProgress = await AsyncStorage.getItem('@progress');
      if (!cachedProgress) return;

      const progressData = JSON.parse(cachedProgress);
      const now = Date.now();
      let dueCount = 0;

      // Count due compound words
      if (progressData.compoundProgress) {
        Object.values(progressData.compoundProgress).forEach(charProgress => {
          if (charProgress.quizScores) {
            Object.values(charProgress.quizScores).forEach(quizData => {
              if (quizData.nextReview && quizData.nextReview <= now) {
                dueCount++;
              }
            });
          }
        });
      }

      // Count due characters
      if (progressData.characterProgress) {
        Object.values(progressData.characterProgress).forEach(charData => {
          if (charData.quizScore?.nextReview && charData.quizScore.nextReview <= now) {
            dueCount++;
          }
        });
      }

      setDueCardsCount(dueCount);
    } catch (error) {
      console.error('[APP] Error updating due cards count:', error);
    }
  };

  const initializeApp = async () => {
    try {
      // Check for saved user session
      const savedUser = await AsyncStorage.getItem('currentUser');
      if (savedUser) {
        console.log('[APP] Found saved user:', savedUser);
        setCurrentUser(savedUser);
        setIsAuthenticated(true);
      }

      // Initialize sync manager
      await syncManager.initialize();

      // Listen for sync status changes
      syncManager.addListener((status) => {
        setSyncStatus(prev => ({
          ...prev,
          online: Boolean(status.online !== undefined ? status.online : prev.online),
          queueSize: status.queueSize !== undefined ? status.queueSize : prev.queueSize
        }));
      });
    } catch (error) {
      console.error('[APP] Initialization error:', error);
    }

    setLoading(false);
  };

  const handleLogin = (username, isAdmin) => {
    console.log('[APP] handleLogin called with:', username, isAdmin);
    setCurrentUser(username);
    console.log('[APP] setCurrentUser completed');
    setIsAuthenticated(true);
    console.log('[APP] setIsAuthenticated completed - will now render NavigationContainer');
  };

  const handleLogout = async () => {
    await AsyncStorage.removeItem('currentUser');
    await AsyncStorage.removeItem('isAdmin');
    setIsAuthenticated(false);
    setCurrentUser(null);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <Text>Loading...</Text>
      </View>
    );
  }

  if (!isAuthenticated) {
    return <AuthScreen onLogin={handleLogin} />;
  }

  return (
    <>
      {/* Offline/Sync Status Banner */}
      {syncStatus.online === false && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>
            🔴 Offline - Progress will sync when connected
          </Text>
        </View>
      )}

      {syncStatus.online === true && syncStatus.queueSize > 0 && (
        <View style={styles.syncingBanner}>
          <Text style={styles.syncingText}>
            🔄 Syncing {syncStatus.queueSize} action(s)...
          </Text>
        </View>
      )}

      <NavigationContainer>
        <Tab.Navigator
          screenOptions={{
            tabBarActiveTintColor: COLORS.primary,
            tabBarInactiveTintColor: COLORS.textLight,
            tabBarStyle: {
              paddingBottom: 8,
              paddingTop: 8,
              height: 65,
              borderTopColor: COLORS.primaryLight,
              borderTopWidth: 1,
              backgroundColor: COLORS.white,
            },
            tabBarLabelStyle: {
              fontSize: 12,
              fontWeight: '600',
            },
          }}
        >
          <Tab.Screen
            name="Home"
            component={HomeStack}
            options={{
              tabBarLabel: 'Characters',
              tabBarIcon: ({ color, focused }) => (
                <HomeIcon size={26} color={color} filled={focused} />
              ),
              headerShown: false,
            }}
          />

          <Tab.Screen
            name="Quiz"
            component={QuizScreen}
            options={{
              tabBarLabel: 'Quiz',
              tabBarIcon: ({ color, focused }) => (
                <View>
                  <QuizIcon size={26} color={color} filled={focused} />
                  {dueCardsCount > 0 && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{dueCardsCount}</Text>
                    </View>
                  )}
                </View>
              ),
            }}
          />

          <Tab.Screen
            name="Statistics"
            component={StatisticsScreen}
            options={{
              tabBarLabel: 'Statistics',
              tabBarIcon: ({ color, focused }) => (
                <StatsIcon size={26} color={color} filled={focused} />
              ),
            }}
          />

          <Tab.Screen
            name="Profile"
            options={{
              tabBarLabel: 'Profile',
              tabBarIcon: ({ color, focused }) => (
                <ProfileIcon size={26} color={color} filled={focused} />
              ),
            }}
          >
            {() => <ProfilePlaceholder onLogout={handleLogout} />}
          </Tab.Screen>
        </Tab.Navigator>
      </NavigationContainer>
    </>
  );
}

// Placeholder components (to be implemented)
function ProfilePlaceholder({ onLogout }) {
  return (
    <View style={styles.centered}>
      <Text style={styles.placeholderText}>👤 Profile Screen</Text>
      <Text style={styles.placeholderSubtext}>Stats and settings</Text>
      <Text
        style={[styles.placeholderSubtext, { color: COLORS.primary, marginTop: 20, fontWeight: '600' }]}
        onPress={onLogout}
      >
        Logout
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  offlineBanner: {
    backgroundColor: '#ff9800',
    padding: 10,
    alignItems: 'center',
  },
  offlineText: {
    color: '#fff',
    fontWeight: '600',
  },
  syncingBanner: {
    backgroundColor: '#2196F3',
    padding: 10,
    alignItems: 'center',
  },
  syncingText: {
    color: '#fff',
    fontWeight: '600',
  },
  placeholderText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  placeholderSubtext: {
    fontSize: 16,
    color: '#666',
    marginTop: 10,
  },
  badge: {
    position: 'absolute',
    right: -6,
    top: -3,
    backgroundColor: COLORS.error,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: COLORS.white,
  },
  badgeText: {
    color: COLORS.white,
    fontSize: 11,
    fontWeight: 'bold',
  },
});
