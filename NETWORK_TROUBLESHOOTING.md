# Network Connection Troubleshooting

If you're getting "Could not connect to server" errors when trying to log in, follow these steps:

## Quick Checklist

✓ **Is your phone on the same WiFi as your computer?**
- Go to Settings → WiFi on your phone
- Make sure you're connected to the same network
- IP should be `192.168.1.xxx`

✓ **Is the server running?**
- On your computer, open browser and go to: `http://192.168.1.222:3000`
- You should see the Chinese Word Map website
- If not, the server isn't running

✓ **Can your phone reach the server?**
- On your phone, open a browser (Chrome/Safari)
- Go to: `http://192.168.1.222:3000`
- If it loads, the connection works!
- If not, continue troubleshooting below

---

## Detailed Troubleshooting

### Issue 1: Phone on Different Network

**Symptoms:** App says "Cannot reach server"

**Check:**
1. On your phone: Settings → WiFi → Check network name
2. On your computer: Check WiFi network name
3. They must match!

**Solutions:**
- Connect phone to same WiFi
- OR: Set up port forwarding (advanced, see below)

---

### Issue 2: Server Not Running

**Check if server is running:**

SSH into Synology:
```bash
ssh -p 222 administrator@192.168.1.222
ps aux | grep server-synology
```

**If not running, start it:**
```bash
cd /volume1/web/chinese-word-map
sudo nohup /usr/local/bin/node server-synology.js > server.log 2>&1 &
```

**Check logs:**
```bash
tail -f /volume1/web/chinese-word-map/server.log
```

---

### Issue 3: Firewall Blocking Connections

**Synology Firewall:**
1. Log into Synology DSM: `http://192.168.1.222:5000`
2. Go to: Control Panel → Security → Firewall
3. Check if firewall is blocking port 3000
4. Add rule to allow port 3000 if needed

**Router Firewall:**
- Most home routers allow local network traffic by default
- Only an issue if you have custom firewall rules

---

### Issue 4: Using APK Outside Home Network

**Problem:** The app is hardcoded to `192.168.1.222:3000` (local network only)

**Current IP:** `192.168.1.222` (only works on local WiFi)

**Solutions:**

**Option A: Use only at home**
- App only works when connected to your home WiFi
- Simplest solution

**Option B: Set up remote access (Advanced)**

1. **Find your public IP:**
   - Go to https://whatismyipaddress.com
   - Note your public IP (e.g., `203.0.113.45`)

2. **Set up port forwarding on your router:**
   - Log into your router (usually `192.168.1.1`)
   - Find "Port Forwarding" or "Virtual Server"
   - Forward external port `3000` → `192.168.1.222:3000`

3. **Update API URL in app:**
   - Edit: `src/services/api.js`
   - Change: `const API_BASE_URL = 'http://YOUR_PUBLIC_IP:3000';`
   - Rebuild APK

4. **Optional: Use dynamic DNS:**
   - Sign up for service like DuckDNS or No-IP
   - Get a domain name (e.g., `mybateman.duckdns.org`)
   - Use domain instead of IP address

**Security Warning:** Opening ports to the internet exposes your server. Make sure:
- Use strong passwords
- Consider adding HTTPS/SSL
- Set up firewall rules
- Maybe use a VPN instead

---

## Testing Connection

### Test 1: From Phone Browser
1. Open Chrome/Safari on phone
2. Go to: `http://192.168.1.222:3000`
3. Should see the Chinese Word Map website
4. If this works, app should work too

### Test 2: From Computer Browser
1. Open browser on computer
2. Go to: `http://192.168.1.222:3000`
3. Should load instantly
4. If not, server isn't running

### Test 3: Check Phone IP
1. Phone Settings → WiFi → Tap connected network
2. Look for IP address
3. Should be `192.168.1.xxx`
4. First 3 numbers must match: `192.168.1`

---

## Common Error Messages

### "Cannot reach server at 192.168.1.222:3000"
→ Phone can't connect to server
→ Check WiFi connection
→ Verify server is running

### "Network request failed"
→ No internet/WiFi connection
→ Check phone WiFi settings

### "timeout of 10000ms exceeded"
→ Server is very slow or not responding
→ Check server logs for errors
→ May need to restart server

### "Invalid credentials"
→ Username or password wrong
→ Server is working! Just wrong login

---

## Current Configuration

- **Server IP:** 192.168.1.222
- **Server Port:** 3000
- **Full URL:** http://192.168.1.222:3000
- **Network:** Local WiFi only (192.168.1.x)
- **Timeout:** 10 seconds

---

## Need Help?

If none of this works:

1. **Check Metro logs** (if running `npx expo start`):
   - Look for connection errors
   - Note the exact error message

2. **Check server logs**:
   ```bash
   ssh -p 222 administrator@192.168.1.222
   tail -50 /volume1/web/chinese-word-map/server.log
   ```

3. **Try from computer first**:
   - If website doesn't work on computer, fix that first
   - Then try phone again

4. **Last resort**: Rebuild the APK
   - Maybe old version with different API URL
   - Build fresh APK with current configuration
