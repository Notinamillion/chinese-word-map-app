// Daily sentence mode, modelled on Language Reactor's PhrasePump:
// one target word per sentence, pinyin over every word, tap any word to mark it known / learning / ignore.
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import * as Speech from 'expo-speech';
import api from '../services/api';
import COLORS from '../theme/colors';

const STATUS_LABELS = { known: 'Known', learning: 'Learning', ignored: 'Ignore' };

export default function SentencePump({ onExit }) {
  const [cards, setCards] = useState([]);
  const [index, setIndex] = useState(0);
  const [stats, setStats] = useState({ done: 0, goal: 60, newToday: 0, newPerDay: 10 });
  const [marks, setMarks] = useState({}); // word -> status tapped on this card
  const [selected, setSelected] = useState(null); // token being looked at
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getPumpNext(10);
      setCards(data.cards || []);
      setIndex(0);
      setStats({ done: data.done, goal: data.goal, newToday: data.newToday, newPerDay: data.newPerDay });
    } catch (e) {
      setError(e.response?.status === 401 ? 'Please log in again.' : 'Could not load sentences. Check your connection.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const card = cards[index];
  const statusOf = (w, s) => marks[w] || s;

  const answer = async (grade) => {
    if (!card || saving) return;
    setSaving(true);
    try {
      const data = await api.answerPump({ sentenceId: card.id, target: card.target, kind: card.kind, grade, words: marks });
      setStats((s) => ({ ...s, done: data.done, newToday: data.newToday }));
      // Statuses set here should show on later cards in this batch too.
      setCards((all) => all.map((c) => ({ ...c, tokens: c.tokens.map((t) => (t.w && marks[t.w] ? { ...t, s: marks[t.w] } : t)) })));
      setMarks({});
      setSelected(null);
      setRevealed(false);
      if (index + 1 < cards.length) setIndex(index + 1);
      else await load();
    } catch (e) {
      setError('Could not save. Try again.');
    }
    setSaving(false);
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>;
  }

  const header = (
    <View style={styles.header}>
      <Pressable onPress={onExit} accessibilityRole="button"><Text style={styles.back}>← Quiz</Text></Pressable>
      <Text style={styles.count}>{stats.done} / {stats.goal} today · new {stats.newToday}/{stats.newPerDay}</Text>
    </View>
  );
  const progress = (
    <View style={styles.bar}><View style={[styles.barFill, { width: `${Math.min(100, (stats.done / stats.goal) * 100)}%` }]} /></View>
  );

  if (error || !card) {
    return (
      <View style={styles.container}>
        {header}
        {progress}
        <View style={styles.center}>
          <Text style={styles.doneTitle}>{error || (stats.done >= stats.goal ? '🎉 Goal reached!' : 'Nothing left to review')}</Text>
          {!error && <Text style={styles.doneText}>Come back tomorrow for {stats.newPerDay} new words.</Text>}
          <Pressable style={styles.primaryBtn} onPress={error ? load : onExit}><Text style={styles.primaryBtnText}>{error ? 'Retry' : 'Back to Quiz'}</Text></Pressable>
        </View>
      </View>
    );
  }

  const targetToken = card.tokens.find((t) => t.w === card.target);
  const look = selected && card.tokens.find((t) => t.w === selected);

  return (
    <View style={styles.container}>
      {header}
      {progress}
      <ScrollView contentContainerStyle={styles.body}>
        {stats.done >= stats.goal && <Text style={styles.goalBanner}>🎉 Daily goal reached — keep going if you like</Text>}
        <View style={styles.card}>
          <View style={styles.cardTop}>
            <Text style={styles.kind}>{card.kind === 'new' ? 'NEW WORD' : card.kind === 'review' ? 'REVIEW' : 'PRACTICE'}</Text>
            <Pressable onPress={() => Speech.speak(card.zh, { language: 'zh-CN' })} accessibilityLabel="Play sentence">
              <Text style={styles.play}>🔊</Text>
            </Pressable>
          </View>

          <View style={styles.sentence}>
            {card.tokens.map((t, i) => {
              if (!t.w) return <Text key={i} style={styles.punct}>{t.t}</Text>;
              const s = statusOf(t.w, t.s);
              const isTarget = t.w === card.target;
              return (
                <Pressable key={i} onPress={() => setSelected(t.w === selected ? null : t.w)}
                  style={[styles.word, isTarget && styles.targetWord, t.w === selected && styles.selectedWord]}>
                  <Text style={[styles.pinyin, styles[`p_${s}`]]}>{t.p}</Text>
                  <Text style={[styles.hanzi, styles[`h_${s}`], isTarget && styles.targetText]}>{t.w}</Text>
                </Pressable>
              );
            })}
          </View>

          {revealed
            ? <Text style={styles.english}>{card.en}</Text>
            : <Pressable onPress={() => setRevealed(true)}><Text style={styles.reveal}>Show English</Text></Pressable>}

          <View style={styles.targetRow}>
            {revealed && <Text style={styles.targetMeaning} numberOfLines={2}>{targetToken?.m}</Text>}
            <View style={styles.targetChip}>
              <Text style={styles.targetChipPinyin}>{targetToken?.p}</Text>
              <Text style={styles.targetChipText}>{card.target}</Text>
            </View>
          </View>
        </View>

        {look && (
          <View style={styles.lookup}>
            <Text style={styles.lookupWord}>{look.w} <Text style={styles.lookupPinyin}>{look.p}</Text></Text>
            {!!look.m && <Text style={styles.lookupMeaning}>{look.m}</Text>}
            <View style={styles.statusRow}>
              {Object.keys(STATUS_LABELS).map((st) => (
                <Pressable key={st} onPress={() => setMarks((m) => ({ ...m, [look.w]: st }))}
                  style={[styles.statusBtn, statusOf(look.w, look.s) === st && styles[`sb_${st}`]]}>
                  <Text style={[styles.statusBtnText, statusOf(look.w, look.s) === st && styles.statusBtnTextOn]}>{STATUS_LABELS[st]}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        <View style={styles.grades}>
          <Pressable disabled={saving} style={[styles.grade, styles.gAgain]} onPress={() => answer('again')}><Text style={styles.gText}>Forgot</Text></Pressable>
          <Pressable disabled={saving} style={[styles.grade, styles.gGood]} onPress={() => answer('good')}><Text style={styles.gText}>Got it</Text></Pressable>
          <Pressable disabled={saving} style={[styles.grade, styles.gEasy]} onPress={() => answer('easy')}><Text style={styles.gText}>Easy</Text></Pressable>
        </View>
        <Text style={styles.hint}>Tap any word to mark it Known, Learning or Ignore.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.lightGray },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  back: { color: COLORS.primary, fontSize: 16, fontWeight: '600' },
  count: { color: COLORS.textMedium, fontSize: 14 },
  bar: { height: 6, backgroundColor: COLORS.mediumGray, marginHorizontal: 16, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 6, backgroundColor: COLORS.primaryGreen },
  body: { padding: 16, paddingBottom: 40 },
  goalBanner: { textAlign: 'center', color: COLORS.greenDark, marginBottom: 8, fontWeight: '600' },
  card: { backgroundColor: COLORS.white, borderRadius: 16, padding: 20, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, elevation: 2 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kind: { fontSize: 11, letterSpacing: 1, color: COLORS.textLight, fontWeight: '700' },
  play: { fontSize: 22 },
  sentence: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'flex-end', marginVertical: 20 },
  word: { alignItems: 'center', paddingHorizontal: 3, paddingVertical: 2, marginHorizontal: 1, borderRadius: 6, borderWidth: 1, borderColor: 'transparent' },
  targetWord: { backgroundColor: COLORS.primaryLight, borderColor: COLORS.primary },
  selectedWord: { borderColor: COLORS.info },
  pinyin: { fontSize: 12, color: COLORS.textLight },
  hanzi: { fontSize: 28, color: COLORS.textDark },
  punct: { fontSize: 28, color: COLORS.textLight, paddingBottom: 2 },
  targetText: { color: COLORS.primaryDark, fontWeight: '700' },
  p_known: { color: COLORS.greenDark }, h_known: { color: COLORS.greenDark },
  p_learning: { color: COLORS.primary }, h_learning: { color: COLORS.primaryDark },
  p_ignored: { color: COLORS.darkGray }, h_ignored: { color: COLORS.darkGray },
  english: { textAlign: 'center', fontSize: 17, color: COLORS.textMedium, marginBottom: 12 },
  reveal: { textAlign: 'center', fontSize: 15, color: COLORS.info, marginBottom: 12, fontWeight: '600' },
  targetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 4 },
  targetMeaning: { flex: 1, color: COLORS.textMedium, fontSize: 13, marginRight: 10, textAlign: 'right' },
  targetChip: { alignItems: 'center', borderWidth: 1, borderColor: COLORS.primary, backgroundColor: COLORS.primaryLight, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  targetChipPinyin: { fontSize: 11, color: COLORS.primaryDark },
  targetChipText: { fontSize: 18, color: COLORS.primaryDark },
  lookup: { backgroundColor: COLORS.white, borderRadius: 12, padding: 14, marginTop: 12 },
  lookupWord: { fontSize: 22, color: COLORS.textDark },
  lookupPinyin: { fontSize: 15, color: COLORS.textMedium },
  lookupMeaning: { fontSize: 14, color: COLORS.textMedium, marginTop: 4 },
  statusRow: { flexDirection: 'row', marginTop: 10, gap: 8 },
  statusBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: COLORS.darkGray, alignItems: 'center' },
  sb_known: { backgroundColor: COLORS.primaryGreen, borderColor: COLORS.primaryGreen },
  sb_learning: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  sb_ignored: { backgroundColor: COLORS.textLight, borderColor: COLORS.textLight },
  statusBtnText: { color: COLORS.textMedium, fontWeight: '600' },
  statusBtnTextOn: { color: COLORS.white },
  grades: { flexDirection: 'row', gap: 10, marginTop: 16 },
  grade: { flex: 1, paddingVertical: 14, borderRadius: 10, alignItems: 'center', borderWidth: 2 },
  gAgain: { backgroundColor: COLORS.qualityForgot.bg, borderColor: COLORS.qualityForgot.border },
  gGood: { backgroundColor: COLORS.qualityGood.bg, borderColor: COLORS.qualityGood.border },
  gEasy: { backgroundColor: COLORS.qualityPerfect.bg, borderColor: COLORS.primary },
  gText: { fontSize: 16, fontWeight: '700', color: COLORS.textDark },
  hint: { textAlign: 'center', color: COLORS.textLight, fontSize: 12, marginTop: 12 },
  doneTitle: { fontSize: 22, fontWeight: '700', color: COLORS.textDark, textAlign: 'center' },
  doneText: { fontSize: 15, color: COLORS.textMedium, marginTop: 8, textAlign: 'center' },
  primaryBtn: { marginTop: 20, backgroundColor: COLORS.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  primaryBtnText: { color: COLORS.white, fontWeight: '700', fontSize: 16 },
});
