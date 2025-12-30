# Chinese Word Map Android App - Session Handoff

## Project Overview

**Project**: Chinese Word Map Android App
**GitHub**: https://github.com/Notinamillion/chinese-word-map-app
**Server**: https://chinese-app.synology.me (Synology NAS at 192.168.1.222)
**Expo Project**: https://expo.dev/accounts/nowaymr/projects/chinesewordappmap

---

## Current Status ✅

### What's Working:
- ✅ Website accessible at https://chinese-app.synology.me
- ✅ Free SSL certificate from Let's Encrypt (auto-renews)
- ✅ Synology DDNS set up (chinese-app.synology.me)
- ✅ Reverse proxy configured (HTTPS → HTTP:3000)
- ✅ Router port forwarding active (80, 443, 3000)
- ✅ App code updated to use HTTPS
- ✅ Session persistence fixed (stays logged in)
- ✅ All sync fixes implemented (cookies, compound words)

### Current App Version:
- **Version**: 1.1.0 (Statistics Dashboard added)
- **Version Code**: 4
- **API URL**: https://chinese-app.synology.me
- **Package**: com.sbateman.chinesewordmap
- **Expo SDK**: 54
- **React**: 19.1.0
- **React Native**: 0.81.2

---

## Key Technical Details

### API Configuration
**File**: `src/services/api.js`
```javascript
const API_BASE_URL = 'https://chinese-app.synology.me';
withCredentials: true  // Sends session cookies
```

### Session Persistence (FIXED)
**File**: `App.js` lines 48-54
```javascript
// Check for saved user session on app startup
const savedUser = await AsyncStorage.getItem('currentUser');
if (savedUser) {
  setCurrentUser(savedUser);
  setIsAuthenticated(true);
}
```

### Data Structure (Synced between Website & App)
```javascript
{
  characterProgress: {
    "人": {
      known: true,
      progress: 50,
      attempts: 10,
      correct: 8
    }
  },
  compoundProgress: {
    "人": {
      known: ["人口", "人民"],  // Array of known compound words
      total: 10,
      quizScores: {
        "人口": {
          attempts: 5,
          correct: 4,
          score: 4,  // 0-5 based on accuracy
          lastQuizzed: timestamp
        }
      }
    }
  }
}
```

### Navigation Structure
- Tab Navigator (bottom tabs)
  - Home Tab → Stack Navigator
    - HomeList screen (character grid)
    - CharacterDetail screen (compounds, mark known)
  - Quiz Tab → QuizScreen
  - Profile Tab → ProfileScreen

---

## Recent Features Added

### 🆕 Statistics Dashboard (Dec 30, 2025) - v1.1.0
**Status**: ✅ IMPLEMENTED

**What Was Added**:
- Complete statistics screen with 3 tabs (Overview, Activity, Words)
- Summary cards: Total Learned, Mastered, Accuracy %, Day Streak
- Progress distribution bars (Struggling/Learning/Good/Mastered)
- Review schedule (Due Today/This Week/Later)
- Recent activity timeline (last 7 days with accuracy and time)
- Words by category (expandable lists)
- Milestones tracking (longest streak, total quizzes, total reviews)
- Pull-to-refresh functionality
- Quiz session tracking with timestamps and duration

**Files Created**:
- `src/screens/StatisticsScreen.js` (850 lines, ported from website)

**Files Modified**:
- `App.js` - Added Statistics tab to navigation
- `src/screens/QuizScreen.js` - Added session metadata tracking, daily stats, streak calculation

**Logic Ported from Website**:
- `calculateStatistics()` - Analyzes progress data and categorizes words
- `getRecentActivity()` - Gets last 7 days of quiz activity
- `updateStreak()` - Calculates current/longest streak
- Session tracking structure matches website 100%

**Data Structure** (now matching website):
```javascript
statistics: {
  quizSessions: [{
    startTime, endTime, mode, totalItems, correctCount, accuracy, duration
  }],
  dailyStats: {
    '2025-12-30': {
      sessionsCount, itemsReviewed, accuracy, timeSpent
    }
  },
  milestones: {
    totalSessions, totalReviews, currentStreak, longestStreak, firstQuizDate
  },
  currentSession: {...}
}
```

---

## Recent Fixes Applied

### 1. Compound Word Sync (CRITICAL)
**Problem**: Website and app used different data structures
**Solution**: Updated app to match website's structure
- **Old**: `compoundProgress[word] = {known: true}`
- **New**: `compoundProgress[char].known = [word1, word2]`

**Files Changed**:
- `src/screens/CharacterDetailScreen.js` (toggle compounds)
- `src/screens/QuizScreen.js` (load/save quiz data)

### 2. Session Cookies (CRITICAL)
**Problem**: API requests not authenticated
**Solution**: Added `withCredentials: true` to axios config
**File**: `src/services/api.js:14`

### 3. Session Persistence (CRITICAL)
**Problem**: App logged out user on restart
**Solution**: Check AsyncStorage for saved user on app startup
**File**: `App.js:48-54`

### 4. Character Quizzing
**Problem**: Only compound words were quizzed
**Solution**: Added individual character quizzing
**File**: `src/screens/QuizScreen.js:67-81`

### 5. Network Configuration
**Problem**: Android blocked HTTP in production APK
**Solution**:
- Switched to HTTPS
- Set up Synology SSL + reverse proxy
- Updated all URLs to https://chinese-app.synology.me

---

## Server Configuration

### Synology NAS Details
- **IP**: 192.168.1.222
- **SSH Port**: 222
- **DSM Port**: 5000
- **App Port**: 3000 (HTTP, behind reverse proxy)
- **DDNS**: chinese-app.synology.me
- **DSM Version**: 6.2.4

### SSH Access
```bash
ssh -p 222 administrator@192.168.1.222
Password: Roc1725s!
```

### Server Location
```bash
cd /volume1/web/chinese-word-map
```

### Server Management
```bash
# Check if running
ps aux | grep server-synology

# Stop server
sudo pkill -f 'node.*server-synology'

# Start server
sudo nohup /usr/local/bin/node server-synology.js > server.log 2>&1 &

# Check logs
tail -f /volume1/web/chinese-word-map/server.log
```

### Reverse Proxy Config
**Location**: DSM → Control Panel → Application Portal → Reverse Proxy

**Rule**: "Chinese Word Map"
- Source: HTTPS, chinese-app.synology.me:443
- Destination: HTTP, localhost:3000

### SSL Certificate
- **Provider**: Let's Encrypt (free)
- **Auto-renews**: Every 90 days
- **Location**: `/usr/syno/etc/certificate/ReverseProxy/bd3cba4c-7419-4d12-a382-a0cf37cd5e2c/`

---

## Building APK

### Current Build Issues
EAS Build has Windows path issues: `Error: ENOENT: mkdir '\\?'`

### Working Solutions

#### Option 1: Interactive Build (Most Reliable)
```powershell
cd C:\Users\s.bateman\ChineseWordMapApp
eas build --platform android --profile preview
# Answer prompts:
# - Generate keystore? → Y
# - Other prompts → Enter (accept defaults)
```

#### Option 2: Expo Web Dashboard
1. Go to https://expo.dev/accounts/nowaymr/projects/chinesewordappmap
2. Click "Builds" → "Create a build"
3. Select Android → preview profile
4. Download APK when complete

#### Option 3: Testing with Expo Go (Immediate)
```powershell
cd C:\Users\s.bateman\ChineseWordMapApp
npx expo start
# Scan QR code with Expo Go app on phone
```

### Build Configuration Files
- `app.json` - App metadata, version, permissions
- `eas.json` - Build profiles (preview = APK, production = AAB)
- `.github/workflows/build-apk.yml` - GitHub Actions build (has issues)

---

## Known Issues

### ❌ RESOLVED ISSUES (Don't need fixing):
- ~~Compound word sync~~ → FIXED
- ~~Session cookies~~ → FIXED
- ~~Session persistence~~ → FIXED
- ~~Character quizzing~~ → FIXED
- ~~HTTP cleartext traffic~~ → FIXED (now using HTTPS)
- ~~Error messages showing old URL~~ → FIXED

### ⚠️ POTENTIAL ISSUES:
- **Windows EAS Build**: CLI has path issues, use web dashboard or interactive mode
- **First-time keystore**: First build needs to generate keystore interactively

---

## File Structure

```
ChineseWordMapApp/
├── App.js                          # Main app entry, navigation, session check
├── app.json                        # Expo config, version, permissions
├── eas.json                        # Build profiles
├── package.json                    # Dependencies
├── src/
│   ├── screens/
│   │   ├── AuthScreen.js           # Login/register
│   │   ├── HomeScreen.js           # Character grid
│   │   ├── CharacterDetailScreen.js # Compound words, mark known
│   │   ├── QuizScreen.js           # Quiz functionality
│   │   └── ProfileScreen.js        # User profile, logout
│   ├── services/
│   │   ├── api.js                  # API client (HTTPS URL here)
│   │   └── syncManager.js          # Offline sync, queue management
│   └── data/
│       └── characters.json         # Character data (bundled)
└── assets/                         # Icons, splash screen
```

---

## Important Commands

### Git Operations
```bash
cd C:\Users\s.bateman\ChineseWordMapApp
git status
git add -A
git commit -m "Your message"
git push
```

### Testing
```bash
# Start Expo dev server
npx expo start

# Start with cache clear
npx expo start -c
```

### Building
```bash
# Build APK (interactive - most reliable)
eas build --platform android --profile preview

# Check build status
eas build:list

# Check who's logged in
eas whoami
```

### Dependencies
```bash
# Install dependencies
npm install

# Install with legacy peer deps (if needed)
npm install --legacy-peer-deps
```

---

## Next Steps

### To Continue Development:

1. **Build the current APK**:
   ```powershell
   eas build --platform android --profile preview
   ```

2. **Test the APK**:
   - Install on Android device
   - Test login (should stay logged in after restart)
   - Test offline mode
   - Verify sync works (mark words on app → check website)

3. **Future Features** (see FEATURE_GAP_ANALYSIS.md for complete details):
   - 🔥 **Statistics Dashboard** (HIGHEST PRIORITY - website logic exists)
   - 🔥 **SM-2 Spaced Repetition Algorithm** (smart quiz scheduling)
   - 🟡 Image upload for characters
   - 🟡 Custom words management
   - 🟢 Edit definitions
   - 🟢 Sentence quiz + management

### Common Next Questions:
- "How do I add a new feature?"
- "How do I update the APK version?"
- "How do I change the app icon/splash screen?"
- "How do I add a new screen/tab?"
- "How do I deploy to Google Play Store?"

---

## Useful Links

- **GitHub Repo**: https://github.com/Notinamillion/chinese-word-map-app
- **Expo Project**: https://expo.dev/accounts/nowaymr/projects/chinesewordappmap
- **Website**: https://chinese-app.synology.me
- **Website Codebase**: C:\Users\s.bateman\chinese-word-map (7,013 line SPA)
- **Feature Gap Analysis**: See FEATURE_GAP_ANALYSIS.md in this repo
- **Expo Docs**: https://docs.expo.dev
- **React Navigation**: https://reactnavigation.org

---

## Key Credentials

### Expo Account
- **Username**: nowaymr
- **Email**: seanmichaelbateman@gmail.com

### Synology NAS
- **User**: administrator
- **Password**: Roc1725s!
- **SSH Port**: 222

### App Users (for testing)
- **Username**: seanb
- **Server**: https://chinese-app.synology.me

---

## Summary for New Session

**What to tell Claude in a new session:**

> I'm continuing work on the Chinese Word Map Android app. The previous session (which is slow) has all the context. Here's the summary:
>
> - App is built with Expo (React Native)
> - Server is on Synology NAS with HTTPS (chinese-app.synology.me)
> - All sync issues are FIXED (sessions, cookies, compound words)
> - Current version: 1.0.0 (versionCode 3)
> - Need to build APK but EAS has Windows path issues
> - Everything is committed to GitHub
>
> See SESSION_HANDOFF.md for complete details.
>
> [Then ask your specific question about what you want to do next]

---

**Created**: 2025-12-30
**Last Updated**: After Statistics Dashboard implementation (v1.1.0)
**Status**: Ready to test statistics, then build APK
