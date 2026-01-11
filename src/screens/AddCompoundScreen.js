import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import api from '../services/api';
import { COLORS } from '../theme/colors';

const AddCompoundScreen = ({ navigation, route }) => {
  const parentChar = route?.params?.character;

  const [character, setCharacter] = useState(parentChar || '');
  const [compound, setCompound] = useState('');
  const [pinyin, setPinyin] = useState('');
  const [meaning, setMeaning] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    // Validation
    if (!character.trim()) {
      Alert.alert('Error', 'Please enter a parent character');
      return;
    }

    if (character.length !== 1) {
      Alert.alert('Error', 'Parent character must be exactly one character');
      return;
    }

    if (!compound.trim()) {
      Alert.alert('Error', 'Please enter a compound word');
      return;
    }

    if (compound.length < 2) {
      Alert.alert('Error', 'Compound must be at least 2 characters');
      return;
    }

    if (!compound.includes(character)) {
      Alert.alert(
        'Warning',
        `The compound "${compound}" doesn't contain the parent character "${character}". Continue anyway?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Continue', onPress: () => submitCompound() },
        ]
      );
      return;
    }

    await submitCompound();
  };

  const submitCompound = async () => {
    if (!pinyin.trim()) {
      Alert.alert('Error', 'Please enter pinyin');
      return;
    }

    if (!meaning.trim()) {
      Alert.alert('Error', 'Please enter meaning');
      return;
    }

    try {
      setLoading(true);

      const response = await api.addCompound({
        character: character.trim(),
        compound: compound.trim(),
        pinyin: pinyin.trim(),
        meaning: meaning.trim(),
      });

      if (response.success) {
        Alert.alert(
          'Success',
          `Compound "${compound}" has been added successfully!`,
          [
            {
              text: 'Add Another',
              onPress: () => {
                setCompound('');
                setPinyin('');
                setMeaning('');
              },
            },
            {
              text: 'Done',
              onPress: () => navigation.goBack(),
            },
          ]
        );
      } else {
        Alert.alert('Error', response.message || 'Failed to add compound');
      }
    } catch (error) {
      console.error('[ADD COMPOUND] Error:', error);
      Alert.alert('Error', error.message || 'Failed to add compound');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <Text style={styles.title}>Add Compound Word</Text>
        <Text style={styles.subtitle}>Create a custom compound for practice</Text>
      </View>

      <View style={styles.form}>
        <View style={styles.inputGroup}>
          <Text style={styles.label}>
            Parent Character <Text style={styles.required}>*</Text>
          </Text>
          <TextInput
            style={[styles.input, styles.characterInput]}
            value={character}
            onChangeText={setCharacter}
            placeholder="e.g., 你"
            placeholderTextColor={COLORS.textLight}
            maxLength={1}
            autoCapitalize="none"
            editable={!parentChar}
          />
          {parentChar && (
            <Text style={styles.helperText}>
              Adding compound for character: {parentChar}
            </Text>
          )}
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>
            Compound Word <Text style={styles.required}>*</Text>
          </Text>
          <TextInput
            style={[styles.input, styles.compoundInput]}
            value={compound}
            onChangeText={setCompound}
            placeholder="e.g., 你好"
            placeholderTextColor={COLORS.textLight}
            autoCapitalize="none"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>
            Pinyin <Text style={styles.required}>*</Text>
          </Text>
          <TextInput
            style={styles.input}
            value={pinyin}
            onChangeText={setPinyin}
            placeholder="e.g., nǐ hǎo"
            placeholderTextColor={COLORS.textLight}
            autoCapitalize="none"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>
            Meaning <Text style={styles.required}>*</Text>
          </Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={meaning}
            onChangeText={setMeaning}
            placeholder="e.g., hello"
            placeholderTextColor={COLORS.textLight}
            multiline
            numberOfLines={3}
          />
        </View>

        <TouchableOpacity
          style={[styles.submitButton, loading && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <Text style={styles.submitButtonText}>Add Compound</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.helpText}>
          * Required fields
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.lightGray,
  },
  header: {
    backgroundColor: COLORS.primary,
    padding: 30,
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.white,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.white,
    opacity: 0.9,
  },
  form: {
    padding: 20,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textDark,
    marginBottom: 8,
  },
  required: {
    color: COLORS.error,
  },
  input: {
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.primaryLight,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: COLORS.textDark,
  },
  characterInput: {
    fontSize: 32,
    textAlign: 'center',
    paddingVertical: 20,
  },
  compoundInput: {
    fontSize: 24,
    textAlign: 'center',
    paddingVertical: 16,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  helperText: {
    fontSize: 14,
    color: COLORS.textMedium,
    marginTop: 8,
    fontStyle: 'italic',
  },
  submitButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 10,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  submitButtonDisabled: {
    backgroundColor: COLORS.textMedium,
  },
  submitButtonText: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: 'bold',
  },
  helpText: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: 16,
    fontStyle: 'italic',
  },
});

export default AddCompoundScreen;
