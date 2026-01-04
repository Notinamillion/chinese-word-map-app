import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import api from '../services/api';
import { COLORS } from '../theme/colors';

export default function SentencePracticeScreen({ route, navigation }) {
  const { character, pinyin } = route.params;
  const [senses, setSenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [practicing, setPracticing] = useState(false);
  const [currentSense, setCurrentSense] = useState(null);
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [results, setResults] = useState([]);

  useEffect(() => {
    loadSentences();
  }, []);

  const loadSentences = async () => {
    try {
      setLoading(true);
      const data = await api.getSentences(character);

      if (data.success && data.senses) {
        setSenses(data.senses);
      }
    } catch (error) {
      console.error('[SENTENCES] Error loading:', error);
      Alert.alert('Error', 'Could not load sentences');
    } finally {
      setLoading(false);
    }
  };

  const startPractice = (sense) => {
    setCurrentSense(sense);
    setCurrentSentenceIndex(0);
    setShowAnswer(false);
    setResults([]);
    setPracticing(true);
  };

  const handleShowAnswer = () => {
    setShowAnswer(true);
  };

  const handleAnswer = (correct) => {
    const sentence = currentSense.sentences[currentSentenceIndex];
    setResults([...results, { sentenceId: sentence.id, correct }]);

    // Move to next sentence
    if (currentSentenceIndex < currentSense.sentences.length - 1) {
      setCurrentSentenceIndex(currentSentenceIndex + 1);
      setShowAnswer(false);
    } else {
      // Practice complete
      completePractice();
    }
  };

  const completePractice = async () => {
    try {
      const data = await api.recordPracticeSession(character, currentSense.senseId, results);

      if (data.success) {
        const correctCount = results.filter(r => r.correct).length;
        const totalCount = results.length;

        Alert.alert(
          'Practice Complete! 🎉',
          `Correct: ${correctCount}/${totalCount}\nNew Mastery: ${data.mastery}/5 ⭐`,
          [{ text: 'OK', onPress: () => {
            setPracticing(false);
            setCurrentSense(null);
            loadSentences(); // Reload to update mastery
          }}]
        );
      }
    } catch (error) {
      console.error('[SENTENCES] Error recording practice:', error);
      Alert.alert('Error', 'Could not save practice results');
      setPracticing(false);
      setCurrentSense(null);
    }
  };

  const getMasteryStars = (mastery) => {
    const stars = [];
    for (let i = 0; i < 5; i++) {
      stars.push(i < mastery ? '⭐' : '☆');
    }
    return stars.join('');
  };

  const getSenseColor = (mastery) => {
    if (mastery === 5) return COLORS.success;
    if (mastery >= 3) return COLORS.primaryYellow;
    if (mastery >= 1) return COLORS.warning;
    return COLORS.error;
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading sentences...</Text>
      </View>
    );
  }

  // Practice Mode
  if (practicing && currentSense) {
    const sentence = currentSense.sentences[currentSentenceIndex];

    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => {
            Alert.alert(
              'Exit Practice?',
              'Your progress will not be saved.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Exit', onPress: () => {
                  setPracticing(false);
                  setCurrentSense(null);
                }}
              ]
            );
          }}>
            <Text style={styles.backButton}>← Exit</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{character} - {currentSense.meaning}</Text>
          <Text style={styles.progress}>
            {currentSentenceIndex + 1}/{currentSense.sentences.length}
          </Text>
        </View>

        <ScrollView contentContainerStyle={styles.quizContent}>
          <View style={styles.quizCard}>
            <Text style={styles.chineseSentence}>{sentence.chinese}</Text>
            {sentence.pinyin && (
              <Text style={styles.pinyinSentence}>{sentence.pinyin}</Text>
            )}

            {showAnswer && (
              <View style={styles.answerBox}>
                <Text style={styles.answerText}>{sentence.english}</Text>
              </View>
            )}
          </View>

          {!showAnswer ? (
            <TouchableOpacity
              style={styles.showButton}
              onPress={handleShowAnswer}
            >
              <Text style={styles.showButtonText}>Show Answer</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.answerButtons}>
              <TouchableOpacity
                style={[styles.answerButton, styles.wrongButton]}
                onPress={() => handleAnswer(false)}
              >
                <Text style={styles.answerButtonText}>❌ Wrong</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.answerButton, styles.correctButton]}
                onPress={() => handleAnswer(true)}
              >
                <Text style={styles.answerButtonText}>✓ Correct</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </View>
    );
  }

  // List Mode
  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{character}</Text>
        <Text style={styles.headerSubtitle}>{pinyin}</Text>
      </View>

      {senses.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>
            No example sentences available for this character yet.
          </Text>
        </View>
      ) : (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📚 Practice by Meaning</Text>
          <Text style={styles.sectionHint}>
            Master each usage separately with example sentences
          </Text>

          {senses.map((sense, index) => (
            <View
              key={index}
              style={[
                styles.senseCard,
                { borderLeftColor: getSenseColor(sense.mastery) }
              ]}
            >
              <View style={styles.senseHeader}>
                <Text style={styles.senseMeaning}>
                  {index + 1}. {sense.meaning}
                </Text>
                <Text style={styles.masteryStars}>
                  {getMasteryStars(sense.mastery)}
                </Text>
              </View>

              <Text style={styles.sentenceCount}>
                {sense.sentences.length} example sentences
                {sense.total > 0 && ` • ${sense.correct}/${sense.total} correct`}
              </Text>

              <TouchableOpacity
                style={styles.practiceButton}
                onPress={() => startPractice(sense)}
              >
                <Text style={styles.practiceButtonText}>
                  {sense.mastery === 5 ? '🔄 Review' : '📝 Practice'}
                </Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
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
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: COLORS.textMedium,
  },
  header: {
    backgroundColor: COLORS.primary,
    padding: 20,
    alignItems: 'center',
  },
  backButton: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: '600',
    alignSelf: 'flex-start',
    marginBottom: 10,
  },
  headerTitle: {
    fontSize: 48,
    fontWeight: 'bold',
    color: COLORS.white,
    marginBottom: 8,
  },
  headerSubtitle: {
    fontSize: 20,
    color: COLORS.white,
    opacity: 0.9,
  },
  progress: {
    color: COLORS.white,
    fontSize: 16,
    marginTop: 8,
  },
  section: {
    padding: 20,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.textDark,
    marginBottom: 8,
  },
  sectionHint: {
    fontSize: 14,
    color: COLORS.textMedium,
    marginBottom: 20,
  },
  senseCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 4,
    shadowColor: COLORS.textDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  senseHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  senseMeaning: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textDark,
    flex: 1,
  },
  masteryStars: {
    fontSize: 16,
  },
  sentenceCount: {
    fontSize: 13,
    color: COLORS.textMedium,
    marginBottom: 12,
  },
  practiceButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  practiceButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600',
  },
  emptyState: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: COLORS.textMedium,
    textAlign: 'center',
  },
  quizContent: {
    padding: 20,
    paddingTop: 40,
  },
  quizCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 32,
    minHeight: 300,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
    marginBottom: 20,
  },
  chineseSentence: {
    fontSize: 28,
    color: COLORS.textDark,
    marginBottom: 16,
    lineHeight: 42,
    textAlign: 'center',
  },
  pinyinSentence: {
    fontSize: 16,
    color: COLORS.primary,
    fontStyle: 'italic',
    marginBottom: 24,
    textAlign: 'center',
  },
  answerBox: {
    marginTop: 16,
    padding: 16,
    backgroundColor: COLORS.lightGray,
    borderRadius: 8,
    width: '100%',
  },
  answerText: {
    fontSize: 18,
    color: COLORS.textDark,
    textAlign: 'center',
    lineHeight: 27,
  },
  showButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  showButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: 'bold',
  },
  answerButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  answerButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  wrongButton: {
    backgroundColor: COLORS.error,
  },
  correctButton: {
    backgroundColor: COLORS.success,
  },
  answerButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: 'bold',
  },
});
