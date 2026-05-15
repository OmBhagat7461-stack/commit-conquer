#!/bin/bash
# Simple backup script for the database
# Usage: ./scripts/backup-db.sh

BACKUP_DIR="./backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

mkdir -p "$BACKUP_DIR"

# Check if DB_PATH is set, otherwise default to local data
DB_PATH=${DB_PATH:-"./data/db.sqlite"}

if [ ! -f "$DB_PATH" ]; then
  echo "Error: Database file not found at $DB_PATH"
  exit 1
fi

cp "$DB_PATH" "$BACKUP_DIR/db_backup_$TIMESTAMP.sqlite"
echo "Backup created: $BACKUP_DIR/db_backup_$TIMESTAMP.sqlite"