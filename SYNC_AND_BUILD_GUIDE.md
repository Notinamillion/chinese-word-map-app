# Complete Guide: Sync Fix & Building APK

## ✅ SYNC FIX APPLIED

The sync issue between app and website has been fixed!

### What Was Wrong:
- The app wasn't sending session cookies with API requests
- Server couldn't identify which user was saving progress
- Progress was saved locally but never reached the server

### What Was Fixed:
- Added `withCredentials: true` to axios configuration in `src/services/api.js`
- Now the app properly sends cookies, allowing the server to authenticate requests
- Progress now syncs: App ↔ Server ↔ Website

### How to Test the Fix:

1. **Mark a character as known in the app:**
   - Long-press any character in the app
   - You should see it turn green with a checkmark
   - Wait 10-15 seconds for sync

2. **Check on the website:**
   - Go to http://192.168.1.222:3000
   - Log in as the same user
   - The character should show as known (green background)

3. **Verify the reverse:**
   - Mark a different character on the website
   - Close and reopen the app
   - The character should appear as known in the app

---

## 📱 BUILDING THE APK

### Option 1: Expo Web Dashboard (EASIEST - RECOMMENDED)

This is the easiest method since EAS Build has Windows compatibility issues.

**Steps:**

1. Open your browser and go to: **https://expo.dev**

2. Log in with your account:
   - Username: `nowaymr`
   - (Use your password)

3. Find your project:
   - Look for "ChineseWordMapApp" in your projects list
   - Or go directly to: https://expo.dev/accounts/nowaymr/projects/ChineseWordMapApp

4. Start a build:
   - Click "Builds" in the left sidebar
   - Click "Create a build" button
   - Select:
     - **Platform**: Android
     - **Build profile**: preview (this creates an APK)
   - Click "Build"

5. Wait for the build:
   - Takes about 10-20 minutes
   - You'll get an email when it's done
   - You can watch progress on the website

6. Download the APK:
   - Click "Download" when build completes
   - Transfer to your Android device
   - Install (you may need to enable "Install from unknown sources")

---

### Option 2: Command Line (If Option 1 Fails)

If the web dashboard doesn't work, you can try initializing EAS manually:

```powershell
cd C:\Users\s.bateman\ChineseWordMapApp

# Initialize EAS project (creates projectId)
eas init

# Then build
eas build --platform android --profile preview
```

This might prompt you for input, which could work better than the non-interactive mode.

---

### Option 3: Local Build with Android Studio

**Requirements:**
- Android Studio installed
- Android SDK (API 34+)
- Java Development Kit (JDK 17+)

**Steps:**

1. Install Android Studio from: https://developer.android.com/studio

2. Open Android Studio and install Android SDK:
   - Tools → SDK Manager
   - Install "Android 14.0 (API 34)"

3. Set environment variable:
   ```powershell
   [System.Environment]::SetEnvironmentVariable("ANDROID_HOME", "C:\Users\s.bateman\AppData\Local\Android\Sdk", "User")
   ```

4. Build the app:
   ```powershell
   cd C:\Users\s.bateman\ChineseWordMapApp
   npx expo prebuild --platform android
   cd android
   .\gradlew assembleRelease
   ```

5. Find the APK:
   ```
   android\app\build\outputs\apk\release\app-release.apk
   ```

---

### Option 4: Quick Testing with Expo Go (No APK Needed)

If you just want to test immediately without building an APK:

1. Install **"Expo Go"** app from Google Play Store on your Android device

2. Make sure your phone and computer are on the same Wi-Fi network

3. On your computer:
   ```powershell
   cd C:\Users\s.bateman\ChineseWordMapApp
   npx expo start
   ```

4. A QR code will appear in the terminal

5. Open Expo Go app on your phone and scan the QR code

6. The app will load and run directly in Expo Go

**Note:** Expo Go is great for testing but has limitations. For a proper standalone app, you need to build an APK.

---

## 🔧 Troubleshooting

### Build Error: "Invalid UUID appId"
- **Fixed!** The invalid projectId has been removed from app.json
- Try building again using Option 1 (Web Dashboard)

### Build Error: "ENOENT: no such file or directory"
- This is a Windows path issue with EAS CLI
- **Solution:** Use the web dashboard (Option 1) instead

### Sync still not working after fix
1. Make sure you're logged in as the same user on both app and website
2. Check that your device is on the same network as the server (192.168.1.222)
3. Check the app shows "Online" status (no orange banner)
4. Look at Metro bundler console for sync logs

### App shows "Offline" banner
- Check network connection
- Verify server is running: http://192.168.1.222:3000
- Make sure device/emulator is on same network as server

---

## 📊 What's New in This Version

✅ Character quizzing (not just compound words)
✅ Mixed character + compound word quizzes
✅ Compound word checkboxes in detail screen
✅ **Fixed progress sync between app and website**
✅ Improved offline persistence
✅ Better error handling

---

## 🎯 Next Steps

1. **Build the APK** using Option 1 (Expo Web Dashboard)
2. **Test the sync fix** by marking words on both app and website
3. Once confirmed working, you can distribute the APK to other users

---

## 📝 Notes

- App Version: **1.0.0**
- Package Name: `com.sbateman.chinesewordmap`
- Server: http://192.168.1.222:3000
- The sync fix is crucial - without it, progress won't persist across devices!
