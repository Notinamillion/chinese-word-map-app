# Complete Synology DDNS + SSL Setup Guide

## What We're Setting Up

You'll get a domain like `bateman.synology.me` that always points to your home IP, with free SSL certificate.

---

## Part 1: Enable DDNS on Synology

### Step 1: Log into Synology DSM
1. Open browser: `http://192.168.1.222:5000`
2. Log in with your admin credentials

### Step 2: Set Up DDNS
1. Go to **Control Panel**
2. Click **External Access**
3. Click **DDNS** tab
4. Click **Add** button

5. Fill in the form:
   - **Service Provider**: Select **Synology**
   - **Hostname**: Choose a name (e.g., `bateman` or `chinese-app`)
     - Final domain will be: `bateman.synology.me`
   - **Username/Email**: Your Synology account email
   - **Password/Key**: Your Synology account password
   - **External Address (IPv4)**: Should auto-detect
   - **Get certificate from Let's Encrypt**: ✅ CHECK THIS BOX
   - **Enable Heartbeat**: ✅ Checked (keeps IP updated)

6. Click **OK**

**Important:** If you don't have a Synology account:
- It will prompt you to create one (free)
- Use any email address
- This is just for DDNS, not buying anything

### Step 3: Verify DDNS is Working

After 1-2 minutes:
1. Status should show: **Normal** (green checkmark)
2. Note your domain: `bateman.synology.me` (or whatever you chose)

Test it:
- Open browser on your computer
- Go to: `http://bateman.synology.me:5000`
- Should reach Synology DSM login

---

## Part 2: Set Up Port Forwarding on Router

You need to forward ports so external traffic reaches your Synology.

### Find Your Router

Usually one of these:
- http://192.168.1.1
- http://192.168.0.1
- http://10.0.0.1

Or check router label/manual.

### Set Up Port Forwarding

1. Log into router web interface
2. Find **Port Forwarding**, **Virtual Server**, or **NAT** section
3. Add these rules:

| Service Name | External Port | Internal IP | Internal Port | Protocol |
|--------------|---------------|-------------|---------------|----------|
| HTTP         | 80            | 192.168.1.222 | 80          | TCP      |
| HTTPS        | 443           | 192.168.1.222 | 443         | TCP      |
| App-HTTP     | 3000          | 192.168.1.222 | 3000        | TCP      |

**Why these ports:**
- **80**: Required for Let's Encrypt certificate verification
- **443**: HTTPS traffic
- **3000**: Your app server (we'll use reverse proxy later)

4. Save/Apply changes
5. Router may restart (wait 2-3 minutes)

---

## Part 3: Get Free SSL Certificate (Let's Encrypt)

### Step 1: Open Certificate Manager
1. Synology DSM → **Control Panel**
2. Click **Security**
3. Click **Certificate** tab

### Step 2: Add Let's Encrypt Certificate
1. Click **Add** button
2. Select **Add a new certificate**
3. Click **Next**

4. Select **Get a certificate from Let's Encrypt**
5. Click **Next**

6. Fill in details:
   - **Domain name**: `bateman.synology.me` (your DDNS domain)
   - **Email**: Your email (for renewal reminders)
   - **Subject Alternative Name**: (leave blank)

7. Click **Apply**

### What Happens Next:
- Synology contacts Let's Encrypt
- Verifies you own the domain (uses port 80)
- Downloads SSL certificate
- Installs it automatically
- Takes 1-2 minutes

### Verify SSL Certificate:
1. After it completes, you should see your certificate listed
2. Status: **Normal**
3. Issuer: **Let's Encrypt**

---

## Part 4: Test HTTPS Access

Try accessing your Synology via HTTPS:

1. Open browser
2. Go to: `https://bateman.synology.me:5001`
3. Should see:
   - 🔒 Padlock icon (secure)
   - Synology login page
   - No certificate warnings

If you see certificate warnings, wait 5 minutes and try again (DNS propagation).

---

## Part 5: Set Up Reverse Proxy for Your App

Now let's make your app accessible via HTTPS without modifying server code.

### Step 1: Open Application Portal
1. Synology DSM → **Control Panel**
2. Click **Login Portal** (or **Application Portal** on newer DSM)
3. Click **Advanced** tab
4. Click **Reverse Proxy**

### Step 2: Create Reverse Proxy Rule
1. Click **Create** button

2. Fill in **General** section:
   - **Reverse Proxy Name**: `Chinese Word Map`
   - **Source**:
     - Protocol: **HTTPS**
     - Hostname: `bateman.synology.me`
     - Port: **443**
     - Enable HSTS: ✅ (optional, for security)
   - **Destination**:
     - Protocol: **HTTP**
     - Hostname: **localhost**
     - Port: **3000**

3. Click **Save**

### What This Does:
- External: `https://bateman.synology.me` (HTTPS on port 443)
- Routes to: `http://localhost:3000` (your app server)
- Synology handles SSL encryption automatically!

### Test It:
1. Open browser
2. Go to: `https://bateman.synology.me`
3. Should see your Chinese Word Map website
4. Should have 🔒 padlock (secure)

---

## Part 6: Update Your Mobile App

Now update the app to use HTTPS instead of local IP.

### Edit API Configuration

**File**: `C:\Users\s.bateman\ChineseWordMapApp\src\services\api.js`

Change line 7:
```javascript
// OLD:
const API_BASE_URL = 'http://192.168.1.222:3000';

// NEW:
const API_BASE_URL = 'https://bateman.synology.me';
```

### Update App Version

**File**: `C:\Users\s.bateman\ChineseWordMapApp\app.json`

Change versionCode:
```json
"versionCode": 3
```

### Commit Changes
```bash
cd C:\Users\s.bateman\ChineseWordMapApp
git add .
git commit -m "Update API to use HTTPS with DDNS domain"
git push
```

### Rebuild APK
```bash
eas build --platform android --profile preview
```

---

## Part 7: Update Server CORS Settings

Your server needs to allow requests from the new domain.

### SSH into Synology
```bash
ssh -p 222 administrator@192.168.1.222
```

### Edit Server File
```bash
cd /volume1/web/chinese-word-map
nano server-synology.js
```

Find the CORS section (around line 240) and update allowed origin:

```javascript
// OLD:
const allowedOrigin = req.headers.origin || 'http://192.168.1.222:3000';

// NEW:
const allowedOrigin = req.headers.origin || 'https://bateman.synology.me';
```

Or better, allow both:
```javascript
const allowedOrigins = [
  'http://192.168.1.222:3000',
  'https://bateman.synology.me',
  'http://localhost:3000'
];
const origin = req.headers.origin;
if (allowedOrigins.includes(origin)) {
  res.header('Access-Control-Allow-Origin', origin);
}
```

Save and exit (Ctrl+X, Y, Enter)

### Restart Server
```bash
sudo pkill -f 'node.*server-synology'
cd /volume1/web/chinese-word-map
sudo nohup /usr/local/bin/node server-synology.js > server.log 2>&1 &
```

---

## Part 8: Final Testing

### Test from Computer Browser:
1. Go to: `https://bateman.synology.me`
2. Should load Chinese Word Map website
3. Should show 🔒 padlock
4. Try logging in - should work!

### Test from Phone (New APK):
1. Install the new APK (version 3)
2. Open app
3. Try logging in
4. Should connect via HTTPS!

### Test from Mobile Data:
1. Turn off WiFi on phone
2. Use mobile data
3. App should still work! (accessing from internet)

---

## Maintenance

### SSL Certificate Auto-Renewal
- Let's Encrypt certificates expire every 90 days
- Synology automatically renews them
- You'll get email reminders at 30/15/7 days before expiry
- Port 80 must stay open for renewals

### DDNS Updates
- Synology automatically updates your IP if it changes
- "Heartbeat" keeps the IP current
- Check status: Control Panel → External Access → DDNS

### Monitoring
To check if everything is working:
```bash
# Check server is running
ssh -p 222 administrator@192.168.1.222
ps aux | grep server-synology

# Check server logs
tail -f /volume1/web/chinese-word-map/server.log
```

---

## Security Best Practices

Now that your server is on the internet:

1. **Strong Passwords**
   - Change default Synology password
   - Use strong passwords for app accounts

2. **Enable 2FA on Synology**
   - Control Panel → User & Group → Advanced
   - Enable 2-factor authentication

3. **Firewall Rules**
   - Control Panel → Security → Firewall
   - Only allow necessary ports (80, 443, 3000)
   - Block all others

4. **Auto Block & Protection**
   - Control Panel → Security → Protection
   - Enable auto block
   - Enable DoS protection

5. **Keep Updated**
   - Control Panel → Update & Restore
   - Enable auto updates

6. **Monitor Access**
   - Control Panel → Log Center
   - Review connection logs regularly

---

## Troubleshooting

### "Certificate verification failed"
- Check port 80 is forwarded
- Verify domain points to correct IP
- Wait 5 minutes and try again

### "Cannot connect to bateman.synology.me"
- Check router port forwarding is active
- Verify DDNS status is "Normal"
- Test from external network (mobile data)

### "Certificate warnings in browser"
- DNS may not have propagated yet (wait 30 mins)
- Clear browser cache
- Try incognito/private mode

### "App still can't connect"
- Verify you rebuilt APK with new URL
- Check server CORS settings
- Look at server logs for errors

---

## Summary

What you now have:
- ✅ Free domain: `bateman.synology.me`
- ✅ Free SSL certificate (auto-renews)
- ✅ HTTPS access from anywhere
- ✅ Mobile app works on any network
- ✅ Secure encrypted connections

**Your URLs:**
- Website: `https://bateman.synology.me`
- App API: `https://bateman.synology.me`
- Works from: Home WiFi, Mobile data, Any WiFi network

**Costs:**
- DDNS: FREE
- SSL: FREE
- Total: $0/year

---

Ready to start? Let me know when you're at each step and I can help if you get stuck!
