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

const Tab = createBottomTabNavigator();
const HomeStack = createNativeStackNavigator();

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState({ online: true, queueSize: 0 });

  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    try {
      // TEMPORARY: Clear all AsyncStorage to fix corrupted data
      // Remove this after first successful login
      await AsyncStorage.clear();
      console.log('[APP] Cleared AsyncStorage');

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

  // Home Stack Navigator (for navigating to character details)
  function HomeStackNavigator() {
    return (
      <HomeStack.Navigator>
        <HomeStack.Screen
          name="HomeList"
          component={HomeScreen}
          options={{
            headerTitle: 'Chinese Word Map',
            headerRight: () => (
              <Text style={{ marginRight: 15, color: '#667eea' }}>
                {currentUser}
              </Text>
            ),
          }}
        />
        <HomeStack.Screen
          name="CharacterDetail"
          component={CharacterDetailScreen}
          options={({ route }) => ({
            headerTitle: route.params?.character?.char || 'Character',
          })}
        />
      </HomeStack.Navigator>
    );
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
            tabBarActiveTintColor: '#667eea',
            tabBarInactiveTintColor: '#999',
            tabBarStyle: { paddingBottom: 5, height: 60 },
          }}
        >
          <Tab.Screen
            name="Home"
            component={HomeStackNavigator}
            options={{
              tabBarLabel: 'Characters',
              tabBarIcon: ({ color }) => <Text style={{ fontSize: 24 }}>🏠</Text>,
              headerShown: false,
            }}
          />

          <Tab.Screen
            name="Quiz"
            component={QuizPlaceholder}
            options={{
              tabBarLabel: 'Quiz',
              tabBarIcon: ({ color }) => <Text style={{ fontSize: 24 }}>📝</Text>,
            }}
          />

          <Tab.Screen
            name="Sentences"
            component={SentencesPlaceholder}
            options={{
              tabBarLabel: 'Sentences',
              tabBarIcon: ({ color }) => <Text style={{ fontSize: 24 }}>📚</Text>,
            }}
          />

          <Tab.Screen
            name="Profile"
            options={{
              tabBarLabel: 'Profile',
              tabBarIcon: ({ color }) => <Text style={{ fontSize: 24 }}>👤</Text>,
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
function QuizPlaceholder() {
  return (
    <View style={styles.centered}>
      <Text style={styles.placeholderText}>📝 Quiz Screen</Text>
      <Text style={styles.placeholderSubtext}>Coming soon...</Text>
    </View>
  );
}

function SentencesPlaceholder() {
  return (
    <View style={styles.centered}>
      <Text style={styles.placeholderText}>📚 Sentences Screen</Text>
      <Text style={styles.placeholderSubtext}>Coming soon...</Text>
    </View>
  );
}

function ProfilePlaceholder({ onLogout }) {
  return (
    <View style={styles.centered}>
      <Text style={styles.placeholderText}>👤 Profile Screen</Text>
      <Text style={styles.placeholderSubtext}>Stats and settings</Text>
      <Text
        style={[styles.placeholderSubtext, { color: '#667eea', marginTop: 20 }]}
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
});
