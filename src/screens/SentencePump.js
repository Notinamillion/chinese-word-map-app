// Daily sentence mode, modelled on Language Reactor's PhrasePump:
// one target word per sentence, pinyin over every word, tap any word for its meaning and to mark it known / learning / ignore.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import * as Speech from 'expo-speech';
import api from '../services/api';
import COLORS from '../theme/colors';

// Language Reactor colours: purple = not marked yet, green = known, orange = learning; grey = ignored.
const STATUS_LABELS = { new: 'Not marked', known: 'Known', learning: 'Learning', ignored: 'Ignored' };
// Buttons in the word panel, like Language Reactor's: ✓ known, 📖 learning, ⊘ ignore.
const STATUS_BUTTONS = [['known', '✓ Known'], ['learning', '📖 Learning'], ['ignored', '⊘ Ignore']];
const colourOf = (s) => (STATUS_LABELS[s] ? s : 'new');
const PURPLE = '#8E44AD'; // not in the brand palette; matches Language Reactor's "not marked" colour

export default function SentencePump({ onExit }) {
  const [cards, setCards] = useState([]);
  const [index, setIndex] = useState(0);
  const [stats, setStats] = useState({ done: 0, goal: 60, newToday: 0, newPerDay: 10 });
  const [marks, setMarks] = useState({}); // word -> status tapped on this card
  const [selected, setSelected] = useState(null); // token being looked at
  const [hovered, setHovered] = useState(null); // word under the mouse (web)
  const hoverTimer = useRef(0);
  // Short delay so the mouse can travel from the word into its bubble.
  const hoverWord = (w) => { clearTimeout(hoverTimer.current); setHovered(w); };
  const unhoverSoon = () => { clearTimeout(hoverTimer.current); hoverTimer.current = setTimeout(() => setHovered(null), 250); };
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
  // Tapping a word opens its meaning; tapping it again closes it. Status changes only from the panel's buttons.
  const select = (t) => setSelected((cur) => (cur === t.w ? null : t.w));
  const setStatus = (w, s) => setMarks((m) => ({ ...m, [w]: s }));

  const next = async () => {
    if (!card || saving) return;
    setSaving(true);
    try {
      const data = await api.answerPump({ sentenceId: card.id, target: card.target, kind: card.kind, words: marks });
      setStats((s) => ({ ...s, done: data.done, newToday: data.newToday }));
      // Statuses set here show on later cards too; a word now known/ignored loses its remaining sentences.
      const rest = cards.slice(index + 1)
        .filter((c) => !['known', 'ignored'].includes(marks[c.target]))
        .map((c) => ({ ...c, tokens: c.tokens.map((t) => (t.w && marks[t.w] ? { ...t, s: marks[t.w] } : t)) }));
      setMarks({});
      setSelected(null);
      setRevealed(false);
      if (rest.length) { setCards(rest); setIndex(0); } else await load();
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
              const s = colourOf(statusOf(t.w, t.s));
              const isTarget = t.w === card.target;
              return (
                <Pressable key={i} onPress={() => select(t)} accessibilityLabel={`${t.w}: ${STATUS_LABELS[s]}`}
                  onHoverIn={() => hoverWord(t.w)} onHoverOut={unhoverSoon}
                  style={[styles.word, isTarget && [styles.targetWord, styles[`box_${s}`]], hovered === t.w && styles.wordHovered]}>
                  {hovered === t.w && !!t.m && (
                    // Hover bubble (web/desktop), like Language Reactor's; on phones the tap panel below shows the meaning.
                    // Shown below the word: above it gets clipped by the ScrollView.
                    <View style={styles.bubbleWrap} pointerEvents="box-none">
                      <View style={styles.bubbleArrow} />
                      <Pressable style={styles.bubble} onHoverIn={() => hoverWord(t.w)} onHoverOut={unhoverSoon}>
                        {t.m.split(/;\s*/).slice(0, 3).map((line, k) => <Text key={k} style={styles.bubbleLine}>{line}</Text>)}
                        <Pressable onPress={() => setMarks((m) => ({ ...m, [t.w]: 'known' }))} style={[styles.bubbleBtn, s === 'known' && styles.bubbleBtnOn]}>
                          <Text style={styles.bubbleBtnText}>✓</Text>
                        </Pressable>
                      </Pressable>
                    </View>
                  )}
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
            {targetToken && (
              <Pressable onPress={() => select(targetToken)}
                style={[styles.targetChip, styles[`box_${colourOf(statusOf(targetToken.w, targetToken.s))}`]]}>
                <Text style={[styles.targetChipPinyin, styles[`p_${colourOf(statusOf(targetToken.w, targetToken.s))}`]]}>{targetToken.p}</Text>
                <Text style={[styles.targetChipText, styles[`h_${colourOf(statusOf(targetToken.w, targetToken.s))}`]]}>{card.target}</Text>
              </Pressable>
            )}
          </View>
        </View>

        {look && (
          <View style={styles.lookup}>
            <Text style={styles.lookupWord}>{look.w} <Text style={styles.lookupPinyin}>{look.p}</Text></Text>
            {!!look.m && look.m.split(/;\s*/).map((line, k) => (
              <Text key={k} style={k ? styles.lookupMeaning : styles.lookupMain}>{line}</Text>
            ))}
            <View style={styles.statusRow}>
              {STATUS_BUTTONS.map(([s, label]) => {
                const on = colourOf(statusOf(look.w, look.s)) === s;
                return (
                  <Pressable key={s} onPress={() => setStatus(look.w, s)} accessibilityRole="button" accessibilityState={{ selected: on }}
                    style={[styles.statusBtn, on && styles[`box_${s}`]]}>
                    <Text style={[styles.statusBtnText, on && styles[`h_${s}`]]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        <Pressable disabled={saving} style={styles.nextBtn} onPress={next}>
          <Text style={styles.nextText}>Next ▶</Text>
        </Pressable>
        <Text style={styles.hint}>Tap a word for its meaning, then mark it. Purple = not marked, green = known, orange = learning, grey = ignored.</Text>
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
  // zIndex keeps the hover bubble above the rows that follow (each RN-web View is its own stacking context).
  sentence: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'flex-end', marginVertical: 20, zIndex: 2 },
  word: { alignItems: 'center', paddingHorizontal: 3, paddingVertical: 2, marginHorizontal: 1, borderRadius: 6, borderWidth: 1, borderColor: 'transparent' },
  targetWord: { borderWidth: 2 },
  wordHovered: { zIndex: 10 },
  bubbleWrap: { position: 'absolute', top: '100%', left: -120, right: -120, alignItems: 'center', zIndex: 10 },
  bubble: { backgroundColor: '#0B5FA5', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, maxWidth: 240, alignItems: 'center' },
  bubbleLine: { color: COLORS.white, fontSize: 14, textAlign: 'center' },
  bubbleBtn: { marginTop: 6, paddingHorizontal: 12, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' },
  bubbleBtnOn: { backgroundColor: COLORS.primaryGreen, borderColor: COLORS.primaryGreen },
  bubbleBtnText: { color: COLORS.white, fontSize: 15, fontWeight: '700' },
  bubbleArrow: { width: 0, height: 0, borderLeftWidth: 6, borderRightWidth: 6, borderBottomWidth: 6, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#0B5FA5' },
  box_new: { borderColor: PURPLE, backgroundColor: '#F1E8FA' },
  p_new: { color: PURPLE }, h_new: { color: PURPLE },
  box_known: { borderColor: COLORS.primaryGreen, backgroundColor: COLORS.greenLight },
  box_learning: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryLight },
  box_ignored: { borderColor: COLORS.darkGray, backgroundColor: COLORS.lightGray },
  statusRow: { flexDirection: 'row', marginTop: 12, gap: 8 },
  statusBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: COLORS.mediumGray },
  statusBtnText: { fontSize: 15, fontWeight: '600', color: COLORS.textMedium },
  pinyin: { fontSize: 12, color: COLORS.textLight },
  hanzi: { fontSize: 28, color: COLORS.textDark },
  punct: { fontSize: 28, color: COLORS.textLight, paddingBottom: 2 },
  targetText: { fontWeight: '700' },
  p_known: { color: COLORS.greenDark }, h_known: { color: COLORS.greenDark },
  p_learning: { color: COLORS.primary }, h_learning: { color: COLORS.primaryDark },
  p_ignored: { color: COLORS.darkGray }, h_ignored: { color: COLORS.darkGray },
  english: { textAlign: 'center', fontSize: 17, color: COLORS.textMedium, marginBottom: 12 },
  reveal: { textAlign: 'center', fontSize: 15, color: COLORS.info, marginBottom: 12, fontWeight: '600' },
  targetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 4 },
  targetMeaning: { flex: 1, color: COLORS.textMedium, fontSize: 13, marginRight: 10, textAlign: 'right' },
  targetChip: { alignItems: 'center', borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  targetChipPinyin: { fontSize: 11 },
  targetChipText: { fontSize: 18 },
  lookup: { backgroundColor: COLORS.white, borderRadius: 12, padding: 14, marginTop: 12 },
  lookupWord: { fontSize: 22, color: COLORS.textDark },
  lookupPinyin: { fontSize: 15, color: COLORS.textMedium },
  lookupMain: { fontSize: 16, color: COLORS.textDark, marginTop: 6 },
  lookupMeaning: { fontSize: 14, color: COLORS.textMedium, marginTop: 2 },
  nextBtn: { marginTop: 16, backgroundColor: COLORS.primaryGreen, paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  nextText: { fontSize: 17, fontWeight: '700', color: COLORS.white },
  hint: { textAlign: 'center', color: COLORS.textLight, fontSize: 12, marginTop: 12 },
  doneTitle: { fontSize: 22, fontWeight: '700', color: COLORS.textDark, textAlign: 'center' },
  doneText: { fontSize: 15, color: COLORS.textMedium, marginTop: 8, textAlign: 'center' },
  primaryBtn: { marginTop: 20, backgroundColor: COLORS.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  primaryBtnText: { color: COLORS.white, fontWeight: '700', fontSize: 16 },
});
