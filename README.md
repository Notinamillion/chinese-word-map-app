# Chinese Word Map - Android App

Mobile-optimized Android app for learning Chinese characters with offline support and automatic background sync.

## Features

✅ **Offline-First** - Works without internet, syncs when connected
✅ **Character Grid** - Browse and mark 300+ characters as known
✅ **Progress Tracking** - All progress saved locally and synced to server
✅ **Auto-Sync** - Background sync every 10 seconds when online
✅ **Offline Queue** - All actions queued offline and synced when reconnected
✅ **Network Status** - Visual indicators for offline/syncing status
✅ **Same Backend** - Connects to Synology server (192.168.1.222:3000)

## Screens

- 🏠 **Home** - Character grid with search (long-press to mark as known)
- 📝 **Quiz** - Coming soon
- 📚 **Sentences** - Coming soon
- 👤 **Profile** - Stats and logout

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

## Architecture

### Offline Sync Pattern

```
User Action → Store Locally → Queue for Sync → Auto-Sync Every 10s
                ↓                                      ↓
          Update UI Instantly                    Server Updated
```

### File Structure

```
src/
├── services/
│   ├── api.js          - API calls to Synology backend
│   └── syncManager.js  - Offline queue and auto-sync
├── screens/
│   ├── AuthScreen.js   - Login/Register
│   └── HomeScreen.js   - Character grid
└── data/
    └── characters.json - 300+ characters (bundled)
```

## How Offline Mode Works

1. **When Online:**
   - All actions sync immediately to server
   - Progress loads from server
   - Green "Online" indicator

2. **When Offline:**
   - All actions stored in local queue
   - Progress still works locally
   - Orange "Offline" banner shows

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

- Server: `http://192.168.1.222:3000`
- Same API as website
- No code changes needed on server

## Troubleshooting

**Can't connect to server:**
- Make sure phone and computer are on same WiFi
- Server must be running on Synology
- Try opening http://192.168.1.222:3000 in phone browser first

**App won't install:**
- Enable "Install from Unknown Sources" in Android settings
- APK must be signed (EAS Build handles this)

**Sync not working:**
- Check network connection
- Look for offline/syncing banner at top
- Check queue size in console logs

## Next Steps

- Add Quiz screen with offline support
- Add Sentences screen
- Add character detail view
- Add stats to Profile screen
- Implement push notifications for reviews
