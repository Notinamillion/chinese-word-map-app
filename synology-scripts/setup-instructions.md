# Synology Setup Instructions

## Step 1: Exit vi (if you're still in it)
1. Press `Esc`
2. Type `:q!` (quit without saving)
3. Press `Enter`

## Step 2: Copy files to Synology

From your Windows PowerShell, run these commands:

```powershell
# Copy systemd service file
pscp -P 222 -pw "Roc1725s!" "C:\Users\s.bateman\ChineseWordMapApp\synology-scripts\chinese-word-map.service" administrator@192.168.1.222:/tmp/

# Copy backup script
pscp -P 222 -pw "Roc1725s!" "C:\Users\s.bateman\ChineseWordMapApp\synology-scripts\backup-db.sh" administrator@192.168.1.222:/volume1/web/chinese-word-map/

# Copy management script
pscp -P 222 -pw "Roc1725s!" "C:\Users\s.bateman\ChineseWordMapApp\synology-scripts\manage.sh" administrator@192.168.1.222:/volume1/web/chinese-word-map/
```

## Step 3: SSH back into Synology and run these commands

```bash
# Move service file to correct location
sudo mv /tmp/chinese-word-map.service /etc/systemd/system/

# Make scripts executable
sudo chmod +x /volume1/web/chinese-word-map/backup-db.sh
sudo chmod +x /volume1/web/chinese-word-map/manage.sh

# Enable and start the service
sudo systemctl daemon-reload
sudo systemctl enable chinese-word-map.service
sudo systemctl start chinese-word-map.service

# Check status
sudo systemctl status chinese-word-map.service
```

## Step 4: Test the management script

```bash
cd /volume1/web/chinese-word-map

# Check status
./manage.sh status

# View logs
./manage.sh logs

# Create a backup
./manage.sh backup
```

## Step 5: Setup automatic backups (Task Scheduler)

1. Open DSM → Control Panel → Task Scheduler
2. Create → Scheduled Task → User-defined script
3. Settings:
   - Task: `Backup Chinese Word Map DB`
   - User: `root`
   - Schedule: Daily at 3:00 AM
   - Script:
   ```bash
   /volume1/web/chinese-word-map/backup-db.sh
   ```

## Done!

Your server will now:
- ✓ Auto-start on boot
- ✓ Auto-restart if it crashes
- ✓ Auto-backup daily at 3 AM
- ✓ Easy to manage with `./manage.sh` commands
