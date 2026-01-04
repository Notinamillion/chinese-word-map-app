# Chinese Word Map - Mobile App

Mobile-optimized Android app for learning Chinese characters with spaced repetition, sentence practice, and offline support.

## Features

✅ **759 Characters** - Expanded character database with compounds and meanings
✅ **Offline-First** - Works without internet, syncs when connected
✅ **Spaced Repetition** - SM-2 algorithm with Anki-style review scheduling
✅ **Quiz Modes** - Word quiz, Audio quiz, and Sentence quiz
✅ **Example Sentences** - 6,023 sentences from Tatoeba with per-sense mastery tracking
✅ **Progress Tracking** - Detailed statistics with streaks and daily review counts
✅ **Admin Features** - Edit definitions, add memory images, customize content
✅ **Auto-Sync** - Background sync with offline queue
✅ **Password Management** - Change password from profile, forgot password reset

## Screens

- 🏠 **Home** - Character grid with search (long-press to mark as known)
- 📝 **Quiz** - Three quiz modes:
  - **Word Quiz**: Visual flashcards with Chinese/English
  - **Audio Quiz**: Listening comprehension practice
  - **Sentence Quiz**: Practice with real example sentences
- 📊 **Statistics** - View your progress, streaks, and review history
- 👤 **Profile** - Change password and logout

## Recent Updates

### 2026-01-04: Performance Optimizations & Password Management
- **Performance Improvements**:
  - Added React.memo to prevent unnecessary re-renders
  - Implemented sentence caching with AsyncStorage
  - Virtualized compound word lists with FlatList (handles 1,694+ items efficiently)
  - Added progress sync throttling (30-second cache freshness)
  - Reduced network calls significantly

- **Password Management**:
  - Added "Change Password" button to Profile screen
  - Password change requires current password verification
  - Minimum 6 characters for new password
  - Server endpoint: `POST /api/auth/change-password`

- **Bug Fixes**:
  - Fixed duplicate sentences in database (removed 6,000+ duplicates)
  - Added cache versioning system (SENTENCE_CACHE_VERSION = 2)
  - Old sentence caches automatically invalidated

### 2025-12-XX: Sentence Practice Feature
- Added 6,023 example sentences from Tatoeba
- Per-sense mastery tracking for characters
- Sentence quiz mode with practice sessions
- API endpoints for sentence retrieval and progress

### 2025-12-XX: Admin Features
- Admin-only definition editing
- Character image upload capability
- Custom meanings and compound definitions

## Installation

### Option 1: Test with Expo Go (Quickest)

1. Install Expo Go app on your Android phone from Play Store
2. Run on your computer:
   ```bash
   cd C:\Users\s.bateman\ChineseWordMapApp
   npm start
   ```
3. Scan the QR code with Expo Go app
4. App runs immediately on your phone

### Option 2: Build APK (Standalone)

1. Install EAS CLI:
   ```bash
   npm install -g eas-cli
   ```

2. Configure EAS (first time only):
   ```bash
   cd C:\Users\s.bateman\ChineseWordMapApp
   eas build:configure
   ```

3. Build APK:
   ```bash
   eas build --platform android --profile preview --local
   ```

4. APK will be generated in `build` folder
5. Copy to phone and install

## Server Setup

### Updating the Server

When changes are made to `synology-scripts/server-current.js`, update the Synology server:

1. Upload the updated server file:
   ```powershell
   pscp -P 222 -pw "Roc1725s!" "C:\Users\s.bateman\ChineseWordMapApp\synology-scripts\server-current.js" administrator@192.168.1.222:/volume1/web/chinese-word-map/server-synology.js
   ```

2. Restart the server (requires SSH access):
   ```bash
   ssh -p 222 administrator@192.168.1.222
   sudo pkill -9 -f 'node.*server-synology'
   cd /volume1/web/chinese-word-map
   sudo nohup /usr/local/bin/node server-synology.js > server.log 2>&1 &
   ```

3. Verify the server is running:
   ```bash
   ps aux | grep server-synology | grep -v grep
   ```

### Server Database

The app uses SQLite on the Synology server:
- **Location**: `/volume1/web/chinese-word-map/database/chinese-app.db`
- **Tables**: users, progress, sentences, sentence_progress, characters

To check the database:
```bash
ssh -p 222 administrator@192.168.1.222
sqlite3 /volume1/web/chinese-word-map/database/chinese-app.db
```

## Architecture

### Offline Sync Pattern

```
User Action → Store Locally → Queue for Sync → Auto-Sync Every 10s
                ↓                                      ↓
          Update UI Instantly                    Server Updated
```

### Caching Strategy

- **Character Data**: Bundled with app (`src/data/characters.json`)
- **Progress Data**: Cached locally, synced with 30-second freshness check
- **Sentence Data**: Cached per character with version checking (SENTENCE_CACHE_VERSION)
- **Custom Data**: Cached in AsyncStorage (`@customCharacterData`)

### File Structure

```
src/
├── services/
│   ├── api.js              - API calls to Synology backend
│   ├── syncManager.js      - Offline queue and auto-sync
│   └── sm2Algorithm.js     - Spaced repetition algorithm
├── screens/
│   ├── AuthScreen.js       - Login/Register/Forgot Password
│   ├── HomeScreen.js       - Character grid
│   ├── CharacterDetailScreen.js - Character details with compounds & sentences
│   ├── QuizScreen.js       - Quiz modes (word, audio, sentence)
│   ├── StatisticsScreen.js - Progress tracking and stats
│   └── SentencePracticeScreen.js - Sentence practice
├── data/
│   └── characters.json     - 759 characters with compounds (bundled)
└── components/
    └── icons/              - Custom SVG icons
```

## How Offline Mode Works

1. **When Online:**
   - All actions sync immediately to server
   - Progress loads from server (cached for 30 seconds)
   - Sentences load from API (cached indefinitely with versioning)
   - Green checkmark indicator

2. **When Offline:**
   - All actions stored in local queue
   - Progress still works locally
   - Orange "Offline" banner shows
   - Cached data continues to work

3. **When Reconnected:**
   - Queue processes automatically
   - All actions sync to server
   - Blue "Syncing X actions..." shows
   - Syncs complete, back to normal

## Development

```bash
# Install dependencies
npm install

# Start development server
npm start

# Run on Android emulator
npm run android

# Run on connected device
npm run android -- --device
```

## Backend Connection

- **Production**: `https://chinese-app.synology.me` (HTTPS with SSL)
- **Local Development**: `http://192.168.1.222:3000`
- Server runs on Synology NAS (DSM 7.0)
- Uses Express.js with sqlite3

## API Endpoints

### Authentication
- `POST /api/auth/login` - Login with username/password
- `POST /api/auth/register` - Create new account
- `POST /api/auth/logout` - Logout
- `POST /api/auth/forgot-password` - Request password reset
- `POST /api/auth/change-password` - Change password (requires auth)

### Progress
- `GET /api/progress` - Get user progress
- `POST /api/progress` - Save user progress

### Sentences
- `GET /api/sentences/:char` - Get sentences for character
- `POST /api/sentences/practice` - Record practice session

### Admin Only
- `POST /api/word-edits` - Save custom definitions
- `POST /api/characters/:char/image` - Upload character image

## Troubleshooting

**Can't connect to server:**
- Make sure phone and computer are on same WiFi
- Server must be running on Synology
- Check server logs: `/volume1/web/chinese-word-map/server.log`
- Try opening https://chinese-app.synology.me in phone browser first

**Password change shows 404 error:**
- Server needs to be restarted after updating server-current.js
- SSH into Synology and restart the server (see Server Setup section above)

**App won't install:**
- Enable "Install from Unknown Sources" in Android settings
- APK must be signed (EAS Build handles this)

**Sync not working:**
- Check network connection
- Look for offline/syncing banner at top
- Check queue size in console logs

**Duplicate sentences appearing:**
- Clear app data or reinstall app (cache will rebuild with version 2)
- Database duplicates have been removed on server

## Performance Tips

- Character list uses virtualization for large datasets
- Sentences are cached locally per character
- Progress syncs maximum once per 30 seconds
- Components use React.memo to prevent unnecessary re-renders

## Future Enhancements

- Push notifications for spaced repetition reviews
- Audio recordings for sentence pronunciation
- Handwriting practice mode
- Export/Import progress data
- Custom word lists
- Dark mode theme

## License

Private project for personal use.
