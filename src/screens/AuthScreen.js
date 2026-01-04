import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import api from '../services/api';

export default function AuthScreen({ onLogin }) {
  const [mode, setMode] = useState('login'); // 'login', 'register', or 'forgot'
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!username || !password) {
      Alert.alert('Error', 'Please enter username and password');
      return;
    }

    console.log('[AUTH] 1. Starting login...');
    setLoading(true);
    console.log('[AUTH] 2. Set loading to true');

    try {
      console.log('[AUTH] 3. Calling api.login...');
      const result = await api.login(username, password);
      console.log('[AUTH] 4. Login response:', JSON.stringify(result));

      if (result.success) {
        console.log('[AUTH] 5. Login successful, calling onLogin with isAdmin:', result.isAdmin, 'type:', typeof result.isAdmin);
        onLogin(username, result.isAdmin);
        console.log('[AUTH] 6. onLogin completed');
      } else {
        Alert.alert('Login Failed', result.message || 'Invalid credentials');
      }
    } catch (error) {
      console.error('[AUTH] ERROR:', error);
      const errorMsg = error.code === 'ECONNREFUSED' || error.message?.includes('Network')
        ? 'Cannot reach server at https://chinese-app.synology.me\n\nMake sure:\n• You have internet connection\n• Server is running\n• You can access https://chinese-app.synology.me in browser'
        : `Connection error: ${error.message || 'Unknown error'}`;
      Alert.alert('Connection Error', errorMsg);
    } finally {
      console.log('[AUTH] 7. Setting loading to false');
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!username || !email || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    setLoading(true);
    try {
      const result = await api.register(username, email, password);
      if (result.success) {
        Alert.alert('Success', 'Account created! Please log in.');
        setMode('login');
      } else {
        Alert.alert('Registration Failed', result.message || 'Could not create account');
      }
    } catch (error) {
      const errorMsg = error.code === 'ECONNREFUSED' || error.message?.includes('Network')
        ? 'Cannot reach server at https://chinese-app.synology.me\n\nMake sure:\n• You have internet connection\n• Server is running'
        : `Connection error: ${error.message || 'Unknown error'}`;
      Alert.alert('Connection Error', errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      Alert.alert('Error', 'Please enter your email address');
      return;
    }

    setLoading(true);
    try {
      const result = await api.forgotPassword(email);
      if (result.success) {
        Alert.alert(
          'Email Sent',
          'If an account exists with this email, you will receive a password reset link shortly. Please check your inbox.',
          [{ text: 'OK', onPress: () => setMode('login') }]
        );
        setEmail('');
      } else {
        Alert.alert('Error', result.message || 'Could not send reset email');
      }
    } catch (error) {
      const errorMsg = error.code === 'ECONNREFUSED' || error.message?.includes('Network')
        ? 'Cannot reach server. Please check your internet connection.'
        : `Error: ${error.message || 'Unknown error'}`;
      Alert.alert('Connection Error', errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <View style={styles.content}>
        <Text style={styles.title}>🀄 Chinese Word Map</Text>
        <Text style={styles.subtitle}>
          {mode === 'login' && 'Sign in to continue'}
          {mode === 'register' && 'Create your account'}
          {mode === 'forgot' && 'Reset your password'}
        </Text>

        {mode !== 'forgot' && (
          <TextInput
            style={styles.input}
            placeholder="Username"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            editable={!loading}
          />
        )}

        {(mode === 'register' || mode === 'forgot') && (
          <TextInput
            style={styles.input}
            placeholder="Email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            editable={!loading}
          />
        )}

        {mode !== 'forgot' && (
          <TextInput
            style={styles.input}
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            editable={!loading}
          />
        )}

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={
            mode === 'login' ? handleLogin :
            mode === 'register' ? handleRegister :
            handleForgotPassword
          }
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>
              {mode === 'login' && 'Sign In'}
              {mode === 'register' && 'Create Account'}
              {mode === 'forgot' && 'Send Reset Link'}
            </Text>
          )}
        </TouchableOpacity>

        {mode === 'login' && (
          <TouchableOpacity
            onPress={() => setMode('forgot')}
            disabled={loading}
            style={{ marginTop: 15 }}
          >
            <Text style={styles.forgotText}>Forgot password?</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          onPress={() => {
            if (mode === 'forgot') {
              setMode('login');
            } else {
              setMode(mode === 'login' ? 'register' : 'login');
            }
          }}
          disabled={loading}
        >
          <Text style={styles.switchText}>
            {mode === 'login' && "Don't have an account? Sign up"}
            {mode === 'register' && 'Already have an account? Sign in'}
            {mode === 'forgot' && '← Back to sign in'}
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 10,
    color: '#333',
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 40,
    color: '#666',
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 15,
    marginBottom: 15,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#ddd',
    color: '#333',
  },
  button: {
    backgroundColor: '#667eea',
    borderRadius: 8,
    padding: 15,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  switchText: {
    textAlign: 'center',
    color: '#667eea',
    marginTop: 20,
    fontSize: 14,
  },
  forgotText: {
    textAlign: 'center',
    color: '#667eea',
    fontSize: 14,
  },
});
