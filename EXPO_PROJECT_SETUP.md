# How to Set Up Expo Project (Due to Windows CLI Issues)

The EAS CLI has Windows path compatibility issues, so we need to create the project via the Expo website instead.

## Step-by-Step Instructions

### Step 1: Create Project on Expo Website

1. Go to: **https://expo.dev/accounts/nowaymr/projects**

2. Log in if not already logged in

3. Click **"+ Create a project"** or **"New Project"** button

4. Fill in the form:
   - **Project Name**: `ChineseWordMapApp` (or `Chinese Word Map App`)
   - **Slug**: `ChineseWordMapApp` (should auto-fill from name)
   - Leave other fields as default

5. Click **"Create"** button

6. Once created, you'll see a **Project ID** displayed (looks like: `abc12345-6789-def0-1234-56789abcdef0`)
   - **Copy this ID!** You'll need it for the next step

---

### Step 2: Add Project ID to app.json

1. Open: `C:\Users\s.bateman\ChineseWordMapApp\app.json`

2. Find the closing of the `"web"` section (around line 29-30)

3. Add the `extra` section BEFORE the final closing braces:

```json
{
  "expo": {
    "name": "Chinese Word Map",
    "slug": "ChineseWordMapApp",
    ...
    "web": {
      "favicon": "./assets/favicon.png"
    },
    "extra": {
      "eas": {
        "projectId": "PASTE_YOUR_PROJECT_ID_HERE"
      }
    }
  }
}
```

4. Replace `PASTE_YOUR_PROJECT_ID_HERE` with the actual Project ID you copied

5. Save the file

---

### Step 3: Commit the Change

```powershell
cd C:\Users\s.bateman\ChineseWordMapApp
git add app.json
git commit -m "Add EAS project ID"
git push
```

---

### Step 4: Build the APK

Now you can build the APK either via:

**Option A: Website (Recommended)**
1. Go to your project page: `https://expo.dev/accounts/nowaymr/projects/ChineseWordMapApp`
2. Click "Builds" in the left sidebar
3. Click "Create a build"
4. Select:
   - Platform: **Android**
   - Build profile: **preview** (creates APK)
5. Click "Build"
6. Wait 10-20 minutes
7. Download the APK when ready

**Option B: Command Line**
```powershell
cd C:\Users\s.bateman\ChineseWordMapApp
eas build --platform android --profile preview
```

---

## What if I Don't See "Create a Project" Button?

If you're already on your account page but don't see a create button:

1. Look for a **"+"** button or **"Add"** button in the top-right
2. Or try this direct link: **https://expo.dev/create-project**
3. Or try: **https://expo.dev/accounts/nowaymr**

---

## Example Project ID Format

Your project ID will look something like one of these:
- `a1b2c3d4-e5f6-7890-abcd-ef1234567890`
- `12345678-1234-1234-1234-123456789abc`

It's always a UUID (universally unique identifier) format.

---

## After Adding the Project ID

Once you've added the project ID and committed it:

1. The project will show up on https://expo.dev under your account
2. You can start builds from the website or command line
3. All future builds will be linked to this project
4. You can share the project with team members

---

## Troubleshooting

**Q: I created the project but can't find the Project ID**
- Go to your project page
- Click "Settings" or "Project settings"
- Look for "Project ID" - it should be displayed there

**Q: Build fails with "Invalid UUID"**
- Make sure you copied the ENTIRE project ID
- Check for extra spaces or quotes
- The ID should be exactly 36 characters (including hyphens)

**Q: "Project not found" error**
- Make sure you're logged in as `nowaymr`
- Run `eas whoami` to verify
- Double-check the project ID in app.json

---

## Current Project Info

- **Account**: nowaymr
- **App Name**: Chinese Word Map
- **Slug**: ChineseWordMapApp
- **Package**: com.sbateman.chinesewordmap
- **Version**: 1.0.0

Once set up, your project URL will be:
`https://expo.dev/accounts/nowaymr/projects/ChineseWordMapApp`
