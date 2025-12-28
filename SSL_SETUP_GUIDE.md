# SSL Setup Guide for Chinese Word Map

## Why You Need SSL

Currently your app uses HTTP (`http://192.168.1.222:3000`), which:
- ❌ Only works on local WiFi
- ❌ Not secure for internet use
- ❌ Android blocks in some configurations

With HTTPS, you get:
- ✅ Works from anywhere (internet)
- ✅ Secure encrypted connection
- ✅ No Android security warnings
- ✅ Can use from mobile data

---

## Best Solution: Free SSL with Let's Encrypt

### Step 1: Get a Free Domain (DuckDNS)

1. Go to https://www.duckdns.org
2. Sign in with Google/GitHub
3. Add a subdomain, e.g., `bateman-chinese.duckdns.org`
4. Set IP to your **public IP** (find at https://whatismyip.com)
5. Click **Update IP**

**OR use Synology's built-in DDNS:**
- DSM → External Access → DDNS
- Provider: Synology
- Subdomain: `bateman.synology.me`

---

### Step 2: Configure Router Port Forwarding

Log into your router (usually http://192.168.1.1):

1. Find **Port Forwarding** or **Virtual Server** section
2. Add these rules:

| External Port | Internal IP      | Internal Port | Protocol |
|---------------|------------------|---------------|----------|
| 80            | 192.168.1.222    | 80            | TCP      |
| 443           | 192.168.1.222    | 443           | TCP      |
| 3000          | 192.168.1.222    | 3000          | TCP      |

**Why:**
- Port 80: Let's Encrypt needs this for verification
- Port 443: HTTPS traffic
- Port 3000: Your app server (optional, can use reverse proxy instead)

---

### Step 3: Enable SSL on Synology

1. Open Synology DSM: http://192.168.1.222:5000
2. **Control Panel** → **Security** → **Certificate**
3. Click **Add** → **Add a new certificate**
4. Select **Get a certificate from Let's Encrypt**
5. Fill in:
   - **Domain name**: `bateman-chinese.duckdns.org` (or your domain)
   - **Email**: Your email address
   - **Subject Alternative Name**: (leave blank)
6. Click **OK**

Synology will:
- Verify you own the domain
- Issue a free SSL certificate
- Auto-renew every 90 days

---

### Step 4: Configure Your Node.js Server for HTTPS

Update your server to use HTTPS:

**File:** `server-synology.js`

```javascript
const https = require('https');
const fs = require('fs');

// SSL Certificate paths (Synology stores them here)
const sslOptions = {
  key: fs.readFileSync('/usr/syno/etc/certificate/_archive/YOUR_CERT_ID/privkey.pem'),
  cert: fs.readFileSync('/usr/syno/etc/certificate/_archive/YOUR_CERT_ID/cert.pem'),
  ca: fs.readFileSync('/usr/syno/etc/certificate/_archive/YOUR_CERT_ID/chain.pem')
};

// Create HTTPS server instead of HTTP
const server = https.createServer(sslOptions, app);
server.listen(3000, () => {
  console.log('HTTPS Server running on port 3000');
});
```

**OR use reverse proxy** (easier - see below)

---

### Step 5: Set Up Synology Reverse Proxy (EASIER)

Instead of modifying your server code, use Synology's built-in reverse proxy:

1. **Control Panel** → **Application Portal** → **Reverse Proxy**
2. Click **Create**
3. Fill in:

**General:**
- Reverse Proxy Name: `Chinese Word Map`
- Protocol: HTTPS
- Hostname: `bateman-chinese.duckdns.org`
- Port: 443

**Source:**
- Protocol: HTTPS
- Hostname: `bateman-chinese.duckdns.org`
- Port: 443

**Destination:**
- Protocol: HTTP
- Hostname: localhost (or 192.168.1.222)
- Port: 3000

4. Click **Save**

Now:
- External: `https://bateman-chinese.duckdns.org` (HTTPS)
- Routes to: `http://localhost:3000` (your HTTP server)
- Synology handles all SSL encryption!

---

### Step 6: Update Your App

**File:** `src/services/api.js`

```javascript
// OLD:
const API_BASE_URL = 'http://192.168.1.222:3000';

// NEW:
const API_BASE_URL = 'https://bateman-chinese.duckdns.org';
```

**File:** `app.json` - Bump version

```json
"versionCode": 3
```

Then rebuild APK!

---

## Testing

### Test SSL Certificate:
1. Open browser
2. Go to: `https://bateman-chinese.duckdns.org`
3. Should show padlock 🔒 (secure)
4. Click padlock → Certificate should say "Let's Encrypt"

### Test App Connection:
1. Build new APK with HTTPS URL
2. Install on phone
3. Try logging in
4. Should work from anywhere (WiFi or mobile data!)

---

## Automatic Renewal

Let's Encrypt certificates expire every 90 days, but:
- ✅ Synology auto-renews them
- ✅ You get email reminders
- ✅ No manual work needed

---

## Cost Breakdown

| Option                | Cost      | Pros                          | Cons                    |
|-----------------------|-----------|-------------------------------|-------------------------|
| Let's Encrypt + DuckDNS | **FREE**  | Auto-renews, trusted, easy    | Domain name not pretty  |
| Buy domain + Let's Encrypt | $10/year | Custom domain name            | Annual domain cost      |
| Buy SSL certificate   | $10-100/year | One-time setup             | Must renew manually     |
| Self-signed           | FREE      | Quick test                    | Browser warnings        |

---

## Security Considerations

**Once you open ports to internet:**
- ✅ Use strong passwords
- ✅ Enable 2FA on Synology
- ✅ Set up firewall rules
- ✅ Keep Synology DSM updated
- ✅ Monitor access logs

**OR use VPN instead:**
- Set up Synology VPN Server
- Connect phone to VPN
- Access local IP (192.168.1.222) securely
- No ports open to internet

---

## Alternative: Use Tailscale (Easiest Secure Option)

If you don't want to deal with port forwarding:

1. Install Tailscale on Synology (from Package Center)
2. Install Tailscale on your phone
3. Both devices join your private network
4. Access server via Tailscale IP
5. Encrypted, no port forwarding needed!

**Tailscale:**
- FREE for personal use
- Super easy setup
- Works anywhere
- No SSL certificates needed
- More secure than opening ports

---

## Need Help?

**Common Issues:**

**"Can't verify domain"**
- Check port 80 is forwarded
- Verify domain points to correct public IP
- Wait 5 minutes for DNS to update

**"Certificate not renewing"**
- Check port 80 is still forwarded
- Synology needs port 80 for renewal

**"App still can't connect"**
- Make sure you updated API_BASE_URL
- Rebuilt and reinstalled APK
- Check firewall isn't blocking port 443

---

Want me to help you set this up? Let me know which option you prefer!
