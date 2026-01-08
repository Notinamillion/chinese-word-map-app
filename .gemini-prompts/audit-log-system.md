# Gemini CLI Task: Quiz Audit Log System

## Overview
Implement a comprehensive audit logging system for the Chinese Word Map quiz application. This system will track every quiz card attempt with timestamp, quality rating, and other metadata for analysis and debugging.

## Requirements

### 1. Database Schema
Add a new table `quiz_history` to the SQLite database at `/volume1/web/chinese-word-map/database/chinese-app.db`:

```sql
CREATE TABLE IF NOT EXISTS quiz_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  word TEXT NOT NULL,
  word_type TEXT NOT NULL, -- 'character', 'compound', or 'sentence'
  quiz_mode TEXT NOT NULL, -- 'words', 'audio', or 'sentences'
  quality INTEGER NOT NULL, -- 0-5 quality rating
  is_correct INTEGER NOT NULL, -- 1 if quality >= 3, 0 otherwise
  interval_before INTEGER, -- Days before this review
  interval_after INTEGER, -- Days after this review
  easiness_before REAL, -- Easiness factor before
  easiness_after REAL, -- Easiness factor after
  score_before INTEGER, -- Score (0-5) before
  score_after INTEGER, -- Score (0-5) after
  session_id TEXT, -- UUID to group quiz sessions
  created_at INTEGER NOT NULL, -- Unix timestamp in milliseconds
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Index for fast queries
CREATE INDEX IF NOT EXISTS idx_quiz_history_user ON quiz_history(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_history_session ON quiz_history(session_id);
```

### 2. Server API Endpoints (Express.js)

Add these endpoints to `synology-scripts/server-current.js`:

#### POST /api/quiz-history
Record a quiz attempt. Requires authentication.

**Request body:**
```json
{
  "word": "你好",
  "wordType": "compound",
  "quizMode": "words",
  "quality": 4,
  "isCorrect": true,
  "intervalBefore": 3,
  "intervalAfter": 8,
  "easinessBefore": 2.5,
  "easinessAfter": 2.6,
  "scoreBefore": 3,
  "scoreAfter": 4,
  "sessionId": "uuid-v4-string"
}
```

**Response:**
```json
{
  "success": true,
  "id": 123
}
```

**Implementation notes:**
- Use `requireAuth` middleware to get `userId` from session
- Insert into `quiz_history` table
- Use `Date.now()` for `created_at`
- Handle errors gracefully

#### GET /api/quiz-history
Get quiz history for the current user. Requires authentication.

**Query parameters:**
- `limit` (optional, default 100): Max number of records
- `offset` (optional, default 0): Pagination offset
- `word` (optional): Filter by specific word
- `mode` (optional): Filter by quiz mode ('words', 'audio', 'sentences')
- `sessionId` (optional): Get all attempts from specific session
- `startDate` (optional): Unix timestamp - only return records after this date
- `endDate` (optional): Unix timestamp - only return records before this date

**Response:**
```json
{
  "success": true,
  "history": [
    {
      "id": 123,
      "word": "你好",
      "wordType": "compound",
      "quizMode": "words",
      "quality": 4,
      "isCorrect": 1,
      "intervalBefore": 3,
      "intervalAfter": 8,
      "easinessBefore": 2.5,
      "easinessAfter": 2.6,
      "scoreBefore": 3,
      "scoreAfter": 4,
      "sessionId": "uuid-v4-string",
      "createdAt": 1704672000000
    }
  ],
  "total": 456,
  "limit": 100,
  "offset": 0
}
```

**Implementation notes:**
- Use `requireAuth` middleware
- Filter by `user_id = req.session.userId`
- Apply optional filters from query params
- Order by `created_at DESC`
- Return total count for pagination

#### GET /api/quiz-history/export
Export quiz history as CSV file. Requires authentication.

**Query parameters:** Same as GET /api/quiz-history

**Response:**
- Content-Type: `text/csv`
- Content-Disposition: `attachment; filename="quiz-history-YYYY-MM-DD.csv"`

**CSV format:**
```csv
Date,Time,Word,Type,Mode,Quality,Correct,Interval Before,Interval After,Easiness Before,Easiness After,Score Before,Score After,Session ID
2024-01-08,10:30:45,你好,compound,words,4,Yes,3,8,2.5,2.6,3,4,uuid-string
```

**Implementation notes:**
- Same filtering as GET endpoint
- Format `created_at` as readable date/time
- Convert boolean `isCorrect` to Yes/No
- Use current date in filename

### 3. Mobile App Integration (React Native)

Modify `src/screens/QuizScreen.js` to log every quiz attempt:

#### When to log
In the `markQuality` function, after calculating SM-2 data, add:

```javascript
// Log quiz attempt to server
try {
  await api.logQuizAttempt({
    word: currentWord,
    wordType: itemType, // 'character', 'compound', or 'sentence'
    quizMode: quizMode, // 'words', 'audio', or 'sentences'
    quality: quality,
    isCorrect: isCorrect,
    intervalBefore: oldData?.interval || 0,
    intervalAfter: updatedQuizData.interval,
    easinessBefore: oldData?.easiness || 2.5,
    easinessAfter: updatedQuizData.easiness,
    scoreBefore: oldData?.score || 0,
    scoreAfter: updatedQuizData.score,
    sessionId: currentSessionId, // Get from progressData.statistics.currentSession
  });
} catch (error) {
  console.error('[QUIZ] Failed to log quiz attempt:', error);
  // Don't block quiz flow if logging fails
}
```

#### API method
Add to `src/services/api.js`:

```javascript
async logQuizAttempt(data) {
  try {
    const response = await apiClient.post('/api/quiz-history', data);
    return response.data;
  } catch (error) {
    console.error('[API] Log quiz attempt error:', error);
    // Don't throw - logging is non-critical
  }
}

async getQuizHistory(filters = {}) {
  const params = new URLSearchParams();
  if (filters.limit) params.append('limit', filters.limit);
  if (filters.offset) params.append('offset', filters.offset);
  if (filters.word) params.append('word', filters.word);
  if (filters.mode) params.append('mode', filters.mode);
  if (filters.sessionId) params.append('sessionId', filters.sessionId);
  if (filters.startDate) params.append('startDate', filters.startDate);
  if (filters.endDate) params.append('endDate', filters.endDate);

  const response = await apiClient.get(`/api/quiz-history?${params.toString()}`);
  return response.data;
}

async exportQuizHistory(filters = {}) {
  const params = new URLSearchParams();
  if (filters.limit) params.append('limit', filters.limit);
  if (filters.word) params.append('word', filters.word);
  if (filters.mode) params.append('mode', filters.mode);
  if (filters.startDate) params.append('startDate', filters.startDate);
  if (filters.endDate) params.append('endDate', filters.endDate);

  const response = await apiClient.get(`/api/quiz-history/export?${params.toString()}`, {
    responseType: 'blob'
  });
  return response.data;
}
```

### 4. Website UI (Optional - can be done later)

Create a quiz history viewer page at `/chinese-word-map/quiz-history.html`:

**Features:**
- Table showing all quiz attempts
- Filters: Date range, word, quiz mode, quality
- Pagination (50 records per page)
- Export to CSV button
- Statistics summary: Total attempts, accuracy %, average quality
- Session view: Group attempts by session ID

**Design:**
- Use same styling as existing website pages
- Responsive table with horizontal scroll on mobile
- Color code quality ratings (0-2 = red, 3 = yellow, 4-5 = green)

## Testing

### Manual testing steps:
1. Create the database table on Synology server
2. Upload updated `server-current.js` to Synology
3. Restart Node.js server
4. Test POST /api/quiz-history with curl/Postman
5. Test GET /api/quiz-history with various filters
6. Test CSV export
7. Update mobile app and test quiz logging
8. Verify data appears in database

### SQL to check data:
```sql
-- Count total attempts per user
SELECT user_id, COUNT(*) as attempts FROM quiz_history GROUP BY user_id;

-- Recent attempts
SELECT * FROM quiz_history ORDER BY created_at DESC LIMIT 10;

-- Accuracy by mode
SELECT quiz_mode,
       AVG(is_correct) * 100 as accuracy_pct,
       COUNT(*) as total
FROM quiz_history
GROUP BY quiz_mode;
```

## Files to modify:
1. `/volume1/web/chinese-word-map/database/chinese-app.db` - Add table
2. `synology-scripts/server-current.js` - Add API endpoints
3. `src/services/api.js` - Add API methods
4. `src/screens/QuizScreen.js` - Add logging calls

## Expected Output:
After implementation, every quiz card should be logged with full details. The user can:
- View complete quiz history in the app or website
- Export to CSV for analysis in Excel
- Filter by word, mode, date range, session
- Debug issues by seeing exact quality ratings and SM-2 changes
- Verify no cards are being remarked incorrectly

## Notes:
- Logging should be non-blocking (don't fail quiz if log fails)
- Use session ID from `progressData.statistics.currentSession.startTime` (convert to UUID or use timestamp)
- Store "before" and "after" values to track SM-2 algorithm behavior
- CSV export is important for Excel analysis
- Consider adding index on `word` column if queries are slow

## Success Criteria:
✅ Database table created successfully
✅ POST endpoint logs quiz attempts
✅ GET endpoint returns filtered history
✅ CSV export downloads properly formatted file
✅ Mobile app logs every quiz card
✅ No errors in server logs
✅ Quiz flow is not interrupted by logging failures
