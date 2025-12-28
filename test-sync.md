# Testing Progress Sync Between App and Website

## How to Test Sync

### Test 1: App → Server → Website

1. **On the App:**
   - Open the app and log in as "seanb"
   - Long-press a character (e.g., "人") to mark it as known
   - Watch for console logs showing sync status
   - Wait 10-15 seconds for sync to complete

2. **Check Server:**
   - Run this command to check what's in the database:
   ```bash
   cd C:\Users\s.bateman\chinese-word-map
   node check-seanb-progress.js
   ```

3. **On the Website:**
   - Log in to http://192.168.1.222:3000 as "seanb"
   - Look for the character you marked
   - It should show as "known" (green background with checkmark)

### Test 2: Website → Server → App

1. **On the Website:**
   - Log in to http://192.168.1.222:3000 as "seanb"
   - Long-press a character to mark it as known
   - Check browser console for "Saved to server" message

2. **Check Server:**
   ```bash
   cd C:\Users\s.bateman\chinese-word-map
   node check-seanb-progress.js
   ```

3. **On the App:**
   - Close and reopen the app
   - Log in as "seanb"
   - The character should appear as known

## Expected Console Logs

### App Logs (when marking character as known):
```
[HOME] Updated progress from server
[SYNC] Queued action: SAVE_PROGRESS - Queue size: 1
[SYNC] Processing queue: 1 actions
[SYNC] Synced action: SAVE_PROGRESS - Remaining: 0
[SYNC] ✓ All actions synced successfully
```

### Website Logs (when marking character as known):
```
Progress cached locally
☁️ Saved to server
```

## Common Issues

### Issue: App shows "Offline" banner
- Check that your phone/emulator is on the same network as the server (192.168.1.222)
- Check that the server is running on port 3000

### Issue: Sync queue keeps growing
- Check network connectivity
- Check server logs for authentication errors
- The app might not be logged in properly

### Issue: Changes appear locally but not on server
- Check that you're logged in (session cookie might have expired)
- Check server logs for errors
- Run the progress check script to see what's actually in the database

## Debugging Commands

Check sync queue in app (Metro bundler console):
```
syncManager.getQueueSize()  // Should return 0 after sync
syncManager.getOnlineStatus()  // Should return true
```

Check server database:
```bash
cd C:\Users\s.bateman\chinese-word-map
node check-seanb-progress.js
```

Check server is running:
```bash
curl http://192.168.1.222:3000/api/health
```
