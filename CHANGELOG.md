# Changelog - Chinese Word Map App

## 2026-01-03 - Major Improvements

### ✅ Anki-Style Spaced Repetition
- **Only shows due/overdue/new items** in quizzes
- **No repetition within the same day** - items reviewed today are excluded
- **"All Caught Up!" message** when no reviews due
- **Practice Anyway option** to override scheduling
- Matches Anki behavior exactly

### ✅ Due Today Section in Statistics
Shows three categories:
- 🔴 **Overdue** - Past their review date (sorted by most overdue)
- 🟡 **Due Today** - Scheduled for today's review
- 🆕 **New Items** - Marked as known, never quizzed

Features:
- Shows character vs compound breakdown
- "Start Review" button with count
- Changes to "Learn New Items" when only new items available

### ✅ Compound Words Now Appearing
- Fixed filtering that was hiding compound words
- SM-2 algorithm now properly includes compounds
- Compounds appear after completing character reviews

### ✅ Character Database Expansion
- **Added 485 new characters** (274 → 759 total)
- Synchronized with website's 1000 most common characters
- All characters include:
  - Pinyin pronunciation
  - English meanings
  - Compound word examples
  - Frequency ranking

### ✅ Detailed Logging
- Character vs compound breakdown at each filtering stage
- Anki-style filtering statistics
- Helps debug quiz behavior

### ✅ Server-Side Logging
- Request/response logging middleware added
- Ready for debugging mobile app issues
- Logs show API calls and progress sync

### ✅ Progress Sync Improvements
- Local-first architecture (AsyncStorage is source of truth)
- Sync status indicator in Statistics
- Background sync with retry logic
- Fixed issue where server was overwriting local progress

## Bug Fixes
- ✅ Quiz no longer repeats same cards immediately
- ✅ Statistics no longer shows blank after completing questions
- ✅ Progress persists across logout/login
- ✅ Compound words now appear in quizzes
- ✅ "Due Today" shows correct counts including new items

## Technical Improvements
- Switched from `useState` to `useRef` for synchronous state updates
- Corrected filter order in batch loading
- Added `syncManager.queueAction()` for server sync
- Anki-style categorization (overdue/due-today/new/reviewed-today/future)

## Commits
- `b183667` Add 485 missing characters from website
- `e3e880d` Show New Items separately in Due Today section
- `aa2f065` Add Due Today section to Statistics screen
- `f1f1a88` Implement Anki-style spaced repetition
- `309436a` Add detailed logging to debug compound words
- `0cd05aa` Add server sync to Quiz screen progress saves
- `5b0418e` Fix Quiz screen loading stale server data
- `33de13a` Fix question pool by removing session filter
- `d7427ed` Add sync status indicator to Statistics screen
- `dd5df44` Fix Statistics screen overwriting local progress
- `62e1090` Fix loadNextBatch returning same questions
- `bf57992` Fix card repetition with useRef

## Next Steps / Future Improvements
- [ ] Pinyin test mode (automatic for mastered words)
- [ ] Audio test with volume button control (hands-free)
- [ ] Manual quiz mode selection
- [ ] Review history on word cards
- [ ] Multiple choice mode for struggling words
- [ ] Progressive difficulty escalation
