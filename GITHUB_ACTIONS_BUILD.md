# Building APK with GitHub Actions (Windows Workaround)

Since EAS CLI has path issues on Windows, we can use GitHub Actions to build the APK on Linux servers instead.

## Setup (One-Time)

### Step 1: Get your Expo Access Token

1. Go to https://expo.dev/accounts/nowaymr/settings/access-tokens
2. Click **"Create Token"**
3. Name it: `GITHUB_ACTIONS_TOKEN`
4. Click **"Create"**
5. **Copy the token** - you won't see it again!

### Step 2: Add Token to GitHub Secrets

1. Go to your GitHub repo: https://github.com/Notinamillion/chinese-word-map-app
2. Click **"Settings"** tab
3. In the left sidebar, click **"Secrets and variables"** → **"Actions"**
4. Click **"New repository secret"**
5. Fill in:
   - **Name**: `EXPO_TOKEN`
   - **Secret**: Paste the token you copied from Expo
6. Click **"Add secret"**

## Building the APK

### Using GitHub Actions (after setup above)

1. Go to https://github.com/Notinamillion/chinese-word-map-app/actions
2. Click on **"Build Android APK"** workflow in the left sidebar
3. Click **"Run workflow"** dropdown (top right)
4. Click the green **"Run workflow"** button
5. Wait a few seconds and refresh the page
6. A new workflow run will appear - click on it to see progress
7. The build will start on EAS servers
8. Check build status at: https://expo.dev/accounts/nowaymr/projects/chinesewordappmap/builds

### Alternative: Manual Trigger (if you fix Windows issues)

If you ever get Windows working, you can run:
```bash
eas build --platform android --profile preview
```

But GitHub Actions is more reliable for now.

## How It Works

1. GitHub Actions runs on Ubuntu Linux (no Windows path issues)
2. It checks out your code
3. Installs Node.js and dependencies
4. Runs `eas build` which starts the build on Expo's servers
5. You can download the APK from Expo's website when done

## Checking Build Status

After the GitHub Action completes, check:
- https://expo.dev/accounts/nowaymr/projects/chinesewordappmap/builds

The build will take about 10-20 minutes on Expo's servers.

## Download the APK

Once the build completes:
1. Go to the builds page (link above)
2. Find your build
3. Click **"Download"** to get the APK
4. Transfer to your Android device and install

## Troubleshooting

**Error: "EXPO_TOKEN secret not found"**
- Make sure you added the secret in GitHub repo settings
- The name must be exactly `EXPO_TOKEN` (case-sensitive)

**Error: "Authentication failed"**
- Your Expo token might have expired
- Create a new token and update the GitHub secret

**Build doesn't start on EAS**
- Check the GitHub Action logs for errors
- Make sure your Expo account is logged in
- Verify the project ID in app.json is correct

## Benefits of This Approach

✅ No Windows CLI issues
✅ Runs on reliable Linux servers
✅ Can be automated (run on every push if you want)
✅ Build history is tracked in GitHub Actions
✅ Free for public repositories
