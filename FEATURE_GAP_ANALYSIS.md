# Chinese Word Map - Feature Gap Analysis

**Last Updated**: 2025-12-30

## Overview
This document compares the website features (located at `C:\Users\s.bateman\chinese-word-map`) with the Android app to identify missing functionality.

---

## ✅ Features Already Implemented in Android App

1. **User Authentication**
   - Login/Register
   - Session persistence
   - Auto-login from AsyncStorage

2. **Character/Compound Word Browsing**
   - Grid view of 300+ characters
   - Character detail view with compounds
   - Mark characters as "known"
   - Mark compound words as "known"

3. **Basic Quiz System**
   - Word quiz (characters + compounds)
   - Score tracking (correct/total)
   - Basic quiz sessions saved to progress
   - Quiz score calculation (0-5 based on accuracy)

4. **Progress Syncing**
   - Sync progress with server
   - Offline support with local caching
   - Data structure matches website

---

## ❌ Critical Missing Features (High Priority)

### 1. Statistics Dashboard ⭐ **HIGHEST PRIORITY**
**Status**: Completely missing from Android app

**Website Implementation**: `C:\Users\s.bateman\chinese-word-map\index.html` lines 2424-3220

**What's Missing**:
- ❌ Quiz session tracking with timestamps
- ❌ Daily statistics aggregation
- ❌ Streak calculation (current/longest)
- ❌ Summary cards (total learned, mastered words, accuracy %)
- ❌ Recent activity timeline (last 7 days)
- ❌ Progress distribution (struggling/learning/good/mastered)
- ❌ Review schedule (cards due today/this week/later)
- ❌ Sortable word lists by category

**Key Functions to Port**:
```javascript
// Website: index.html
saveQuizSession()         // lines 2424-2478 - Records quiz with metadata
updateStreak()            // lines 2480-2524 - Tracks consecutive days
calculateStatistics()     // lines 2528-2692 - Aggregates by date
renderStatisticsDashboard()    // lines 2774-2790 - Summary cards
renderRecentActivity()         // lines 2792-2888 - 7-day timeline
renderProgressDistribution()   // lines 2890-2960 - Progress bars
renderReviewSchedule()         // lines 2962-3030 - Due cards
showWordList()                 // lines 3032-3220 - Sortable tables
```

**Data Structure**:
```javascript
progressData.statistics = {
  quizSessions: [
    {
      startTime: timestamp,
      endTime: timestamp,
      mode: 'words' | 'characters' | 'sentences',
      itemsReviewed: 10,
      correctAnswers: 8,
      accuracy: 80,
      duration: 120000 // milliseconds
    }
  ],
  dailyStats: {
    '2025-12-30': {
      quizzesTaken: 3,
      totalItems: 30,
      totalCorrect: 24,
      averageAccuracy: 80,
      timeSpent: 360000
    }
  },
  milestones: {
    currentStreak: 5,
    longestStreak: 12,
    lastActivityDate: '2025-12-30'
  }
}
```

**Implementation Priority**: 🔥 **CRITICAL** - User explicitly requested this as main priority

---

### 2. Spaced Repetition System (SM-2 Algorithm)
**Status**: Partially implemented (basic scoring exists, but not SM-2)

**Website Implementation**: `C:\Users\s.bateman\chinese-word-map\index.html` lines 2575-2630

**What's Missing**:
- ❌ SM-2 algorithm calculation (interval, easiness, repetitions)
- ❌ Next review date scheduling
- ❌ Progressive difficulty (Chinese→English, then English→Chinese)
- ❌ Quality rating (0-5) based on response
- ❌ Priority sorting by due date

**Current App Implementation**:
- ✅ Basic attempts/correct tracking (QuizScreen.js:172-204)
- ✅ Score calculation (0-5 based on accuracy)
- ❌ No interval/easiness/nextReview fields

**Website SM-2 Structure**:
```javascript
compoundProgress[char].quizScores[word] = {
  interval: 1,              // Days until next review
  easiness: 2.5,            // Difficulty factor (1.3-2.5)
  repetitions: 0,           // Consecutive correct answers
  nextReview: timestamp,    // When to review next
  lastReviewed: timestamp,
  quality: 3                // User's response quality (0-5)
}
```

**Implementation Priority**: 🔥 **HIGH** - Needed for effective learning

---

### 3. Image Upload for Characters/Words
**Status**: Not implemented

**Website Implementation**:
- Upload: `C:\Users\s.bateman\chinese-word-map\index.html` lines 5600-5800
- Server: `C:\Users\s.bateman\chinese-word-map\server-synology.js` lines 800-850

**What's Missing**:
- ❌ Image picker integration (react-native-image-picker)
- ❌ Upload to `/api/word-images`
- ❌ Display uploaded images in character detail
- ❌ Permission check (`can_upload_images` flag)

**API Endpoint**: `POST /api/word-images`
```javascript
FormData: {
  word: string,
  word_type: 'character' | 'compound',
  image: File
}
```

**Database**: `word_images` table
- word, word_type, image_filename, uploaded_by, created_at

**Implementation Priority**: 🟡 **MEDIUM** - Nice to have for visual learners

---

### 4. Custom Words Management
**Status**: Not implemented

**Website Implementation**:
- UI: `C:\Users\s.bateman\chinese-word-map\index.html` lines 4200-4500
- Server: `C:\Users\s.bateman\chinese-word-map\server-synology.js` lines 600-700

**What's Missing**:
- ❌ Add custom words/compounds (word, pinyin, meanings)
- ❌ Edit custom words
- ❌ Delete custom words
- ❌ Display custom words in character detail
- ❌ Include custom words in quiz

**API Endpoints**:
- `GET /api/custom-words` - List all user's custom words
- `GET /api/custom-words/char/:char` - Get custom words for a character
- `POST /api/custom-words` - Create custom word
- `DELETE /api/custom-words/:id` - Delete custom word

**Database**: `custom_words` table
- id, user_id, word, pinyin, meanings, base_char, created_at

**Implementation Priority**: 🟡 **MEDIUM** - Useful for personalization

---

### 5. Edit Definitions
**Status**: Not implemented

**Website Implementation**:
- UI: `C:\Users\s.bateman\chinese-word-map\index.html` lines 4800-5100
- Server: `C:\Users\s.bateman\chinese-word-map\server-synology.js` lines 700-750

**What's Missing**:
- ❌ Edit meanings for any character/compound
- ❌ Per-word edit history
- ❌ Permission check (`can_edit_definitions` flag)

**API Endpoint**: `POST /api/word-edits`
```javascript
{
  word: string,
  word_type: 'character' | 'compound',
  edited_meanings: string[]
}
```

**Database**: `word_edits` table
- id, word, word_type, edited_meanings, edited_by, created_at

**Implementation Priority**: 🟢 **LOW** - Advanced feature

---

### 6. User Sentences/Context
**Status**: Placeholder exists, not implemented

**Website Implementation**:
- UI: `C:\Users\s.bateman\chinese-word-map\index.html` lines 5200-5500
- Server: `C:\Users\s.bateman\chinese-word-map\server-synology.js` lines 750-800

**What's Missing**:
- ❌ Add custom sentences (Chinese, pinyin, English)
- ❌ Delete sentences
- ❌ Sentence-based quiz mode (mentioned in QuizScreen.js:288)

**API Endpoints**:
- `GET /api/sentences` - List user sentences
- `POST /api/sentences` - Add sentence
- `DELETE /api/sentences/:id` - Delete sentence

**Database**: `user_sentences` table
- id, user_id, chinese, pinyin, english, created_at

**Implementation Priority**: 🟢 **LOW** - Nice to have for context

---

### 7. Network Graph Visualization
**Status**: Not implemented

**Website Implementation**: Uses `vis-network` library (index.html lines 6000+)

**What's Missing**:
- ❌ Interactive graph showing character relationships
- ❌ Visual representation of learned vs unlearned characters

**Implementation Challenges**:
- Complex to implement in React Native
- May need react-native-svg or web-based solution

**Implementation Priority**: 🟢 **LOW** - Visual feature, not critical

---

## 🔧 Features Partially Implemented

### 1. Quiz System
**Current Status**: Basic quiz works

**Improvements Needed**:
- ❌ SM-2 spaced repetition algorithm
- ❌ Progressive difficulty (Chinese→English → English→Chinese)
- ❌ Quality rating (0-5) instead of binary correct/wrong
- ❌ Quiz session metadata (duration, mode, timestamps)
- ❌ Sentence quiz mode (placeholder exists)

**Files to Update**:
- `src/screens/QuizScreen.js` - Add SM-2 logic, quality rating
- `src/services/api.js` - May need new endpoints for quiz data

---

### 2. Character Detail Screen
**Current Status**: Shows compounds, can mark as known

**Improvements Needed**:
- ❌ Show uploaded images
- ❌ Show custom words
- ❌ Show edit history
- ❌ "Edit Definition" button
- ❌ "Upload Image" button
- ❌ "Add Custom Word" button

**File to Update**: `src/screens/CharacterDetailScreen.js`

---

### 3. Profile Screen
**Current Status**: Basic user info, logout

**Improvements Needed**:
- ❌ **Statistics Dashboard** (CRITICAL)
- ❌ User settings (enable/disable features)
- ❌ Data export (download progress as JSON)
- ❌ Admin panel (if user is admin)

**File to Update**: `src/screens/ProfileScreen.js` (currently doesn't exist, need to read it)

---

## 🚫 Website-Only Features (Not Needed in App)

1. **Admin Dashboard** - Web-only, not needed in mobile app
2. **Translation API** - Could be useful, but low priority
3. **PWA Service Worker** - Web-only technology
4. **Text-to-Speech** - Could use React Native TTS library (future consideration)

---

## 📊 Implementation Roadmap

### Phase 1: Statistics Dashboard (Week 1) 🔥
**Goal**: Match website statistics functionality

**Tasks**:
1. Create `src/screens/StatisticsScreen.js`
2. Port statistics calculation logic from website
3. Create UI components:
   - Summary cards (total learned, mastered, accuracy)
   - Recent activity chart (7 days)
   - Progress distribution bars
   - Review schedule
4. Add "Statistics" tab to bottom navigation
5. Test data persistence and sync with server

**Estimated Effort**: 2-3 days
**Files Created/Modified**:
- ✅ NEW: `src/screens/StatisticsScreen.js`
- ✅ EDIT: `App.js` (add tab navigation)
- ✅ EDIT: `src/services/api.js` (if needed)

---

### Phase 2: SM-2 Spaced Repetition (Week 2) 🔥
**Goal**: Implement proper spaced repetition algorithm

**Tasks**:
1. Create `src/services/sm2Algorithm.js` (port from website)
2. Update quiz scoring to use quality ratings (0-5)
3. Add interval/easiness/nextReview to progress data
4. Sort quiz items by priority (due date)
5. Show "due today" count in Statistics screen
6. Progressive difficulty (CN→EN, then EN→CN)

**Estimated Effort**: 2-3 days
**Files Created/Modified**:
- ✅ NEW: `src/services/sm2Algorithm.js`
- ✅ EDIT: `src/screens/QuizScreen.js`
- ✅ EDIT: `src/screens/StatisticsScreen.js`

---

### Phase 3: Custom Words & Images (Week 3) 🟡
**Goal**: Allow users to add custom content

**Tasks**:
1. Add "Add Custom Word" button to CharacterDetailScreen
2. Create custom word form (word, pinyin, meanings)
3. Add image picker integration (react-native-image-picker)
4. Upload images to `/api/word-images`
5. Display custom words and images in character detail
6. Include custom words in quiz

**Estimated Effort**: 3-4 days
**Files Modified**:
- ✅ EDIT: `src/screens/CharacterDetailScreen.js`
- ✅ EDIT: `src/services/api.js` (add endpoints)
- ✅ NEW: `src/components/CustomWordForm.js`
- ✅ NEW: `src/components/ImagePicker.js`

**Dependencies**:
- `npm install react-native-image-picker`
- Permissions: CAMERA, READ_EXTERNAL_STORAGE, WRITE_EXTERNAL_STORAGE

---

### Phase 4: Edit Definitions & Sentences (Week 4) 🟢
**Goal**: Advanced editing features

**Tasks**:
1. Add "Edit Definition" button to CharacterDetailScreen
2. Create edit definition modal
3. Add sentence management screen
4. Implement sentence quiz mode

**Estimated Effort**: 2-3 days
**Files Created/Modified**:
- ✅ NEW: `src/screens/SentencesScreen.js`
- ✅ NEW: `src/components/EditDefinitionModal.js`
- ✅ EDIT: `src/screens/CharacterDetailScreen.js`
- ✅ EDIT: `src/screens/QuizScreen.js`

---

## 📋 Summary of Missing Features by Priority

### 🔥 Critical (Must Have)
1. **Statistics Dashboard** - User explicitly requested, main priority
2. **SM-2 Spaced Repetition** - Core learning functionality

### 🟡 Medium (Should Have)
3. **Image Upload** - Visual learning enhancement
4. **Custom Words** - Personalization

### 🟢 Low (Nice to Have)
5. **Edit Definitions** - Advanced feature
6. **User Sentences** - Context learning
7. **Network Graph** - Visual feature

---

## 🎯 Recommended Next Steps

Based on your request, I recommend:

1. **START WITH**: Statistics Dashboard (Phase 1)
   - This is your explicitly stated priority
   - Most impactful for user engagement
   - Relatively straightforward to implement (mostly UI + data aggregation)

2. **THEN**: SM-2 Spaced Repetition (Phase 2)
   - Critical for effective learning
   - Complements statistics (shows "cards due")
   - Requires refactoring quiz logic

3. **LATER**: Custom content features (Phases 3-4)
   - Nice to have, but not blocking
   - Can be added incrementally

---

## 📝 Additional Notes

### Code Reuse Strategy
- **Maximum Code Sharing**: The website's logic (especially statistics calculation) can be ported almost 1:1 to the Android app
- **Same Data Structure**: App already uses website's data format, so logic should work identically
- **API Compatibility**: All endpoints already exist on server, just need to call them from app

### Testing Strategy
- Test each feature on website first to understand expected behavior
- Compare app calculations with website calculations
- Verify data sync works correctly (app ↔ website)

### Version Planning
- **v1.1.0**: Statistics Dashboard + SM-2
- **v1.2.0**: Custom Words + Images
- **v1.3.0**: Edit Definitions + Sentences
- **v2.0.0**: Network Graph + Advanced features

---

**Next Action**: Review this document and confirm which feature to implement first (recommended: Statistics Dashboard).
