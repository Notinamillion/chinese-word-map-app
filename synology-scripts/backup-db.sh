#!/bin/bash

# Configuration
DB_PATH="/volume1/web/chinese-word-map/database/chinese-app.db"
BACKUP_DIR="/volume1/web/chinese-word-map/backups"
DATE=$(date +%Y-%m-%d_%H-%M-%S)
BACKUP_FILE="$BACKUP_DIR/chinese-app_$DATE.db"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Create backup with SQLite backup command (safer than cp while DB is in use)
sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'"

# Compress backup
gzip "$BACKUP_FILE"

# Keep only last 30 days of backups
find "$BACKUP_DIR" -name "chinese-app_*.db.gz" -mtime +30 -delete

echo "Backup created: $BACKUP_FILE.gz"
