# How to Build Chinese Word Map APK

## Easiest Method: Expo Web Dashboard

1. Go to https://expo.dev and log in
2. Navigate to your "ChineseWordMapApp" project
3. Click "Builds" in the left sidebar
4. Click "Create a build"
5. Select:
   - Platform: Android
   - Build type: APK (for device testing)
6. Wait 10-15 minutes for the build to complete
7. Download the APK and install on your Android device

## Alternative: Command Line (Cloud Build)

Run in PowerShell (as Administrator):

```powershell
cd C:\Users\s.bateman\ChineseWordMapApp
.\build-apk.ps1
```

Or manually:

```powershell
cd C:\Users\s.bateman\ChineseWordMapApp
eas build --platform android --profile preview
```

This builds on Expo's servers and gives you a download link when complete.

## Alternative: Local Build with Android Studio

If you have Android Studio installed with Android SDK:

1. Install Android Studio from https://developer.android.com/studio
2. Install Android SDK (API level 34 or higher)
3. Set ANDROID_HOME environment variable
4. Run:

```bash
cd C:\Users\s.bateman\ChineseWordMapApp
npx expo prebuild --platform android
cd android
.\gradlew assembleRelease
```

The APK will be at: `android/app/build/outputs/apk/release/app-release.apk`

## Testing Without Building

You can test immediately using Expo Go:

1. Install "Expo Go" app from Google Play Store on your Android device
2. On your computer, run:
   ```bash
   cd C:\Users\s.bateman\ChineseWordMapApp
   npx expo start
   ```
3. Scan the QR code with Expo Go app

## Current Build Configuration

- **App Name**: Chinese Word Map
- **Package Name**: com.sbateman.chinesewordmap
- **Version**: 1.0.0
- **Version Code**: 1
- **Target SDK**: Android 14+ (API 34)

## Recent Changes

Latest commit includes:
- Character quizzing (not just compound words)
- Mixed character and compound word quizzes
- Improved progress tracking
- Fixed server sync
- Compound word checkboxes

## Troubleshooting

**Error: "Unsupported platform"**
- Use cloud build instead: `eas build --platform android --profile preview`

**Error: "EAS project not configured"**
- Make sure you're logged in: `eas login`
- The project is already configured in `app.json` and `eas.json`

**Build takes too long**
- Cloud builds typically take 10-20 minutes
- You'll receive an email when complete
- Download link will also appear in terminal
