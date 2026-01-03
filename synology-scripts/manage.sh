#!/bin/bash

APP_DIR="/volume1/web/chinese-word-map"
PID_FILE="/var/run/chinese-word-map.pid"
LOG_FILE="$APP_DIR/server.log"
DB_FILE="$APP_DIR/database/chinese-app.db"
BACKUP_DIR="$APP_DIR/backups"

start() {
    if [ -f "$PID_FILE" ]; then
        echo "Server already running (PID: $(cat $PID_FILE))"
        exit 1
    fi

    echo "Starting Chinese Word Map server..."
    cd "$APP_DIR"
    /usr/local/bin/node server-synology.js > "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    echo "Server started (PID: $(cat $PID_FILE))"
}

stop() {
    if [ ! -f "$PID_FILE" ]; then
        echo "Server not running"
        exit 1
    fi

    echo "Stopping server..."
    kill $(cat "$PID_FILE")
    rm "$PID_FILE"
    echo "Server stopped"
}

status() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p "$PID" > /dev/null; then
            echo "Server is running (PID: $PID)"
        else
            echo "PID file exists but process not found"
            rm "$PID_FILE"
        fi
    else
        echo "Server is not running"
    fi
}

backup() {
    echo "Creating backup..."
    mkdir -p "$BACKUP_DIR"
    DATE=$(date +%Y-%m-%d_%H-%M-%S)
    BACKUP_FILE="$BACKUP_DIR/chinese-app_$DATE.db"

    sqlite3 "$DB_FILE" ".backup '$BACKUP_FILE'"
    gzip "$BACKUP_FILE"

    echo "Backup created: $BACKUP_FILE.gz"

    # Clean old backups
    find "$BACKUP_DIR" -name "chinese-app_*.db.gz" -mtime +30 -delete
}

restore() {
    if [ -z "$1" ]; then
        echo "Available backups:"
        ls -lh "$BACKUP_DIR"
        echo ""
        echo "Usage: $0 restore <backup-file>"
        exit 1
    fi

    BACKUP_FILE="$1"
    if [ ! -f "$BACKUP_FILE" ]; then
        echo "Backup file not found: $BACKUP_FILE"
        exit 1
    fi

    echo "Restoring from $BACKUP_FILE..."
    stop
    gunzip -c "$BACKUP_FILE" > "$DB_FILE"
    start
    echo "Restore complete"
}

logs() {
    tail -f "$LOG_FILE"
}

case "$1" in
    start)
        start
        ;;
    stop)
        stop
        ;;
    restart)
        stop
        sleep 2
        start
        ;;
    status)
        status
        ;;
    backup)
        backup
        ;;
    restore)
        restore "$2"
        ;;
    logs)
        logs
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|backup|restore|logs}"
        exit 1
        ;;
esac
