# Server Package - Disaster Recovery

This package includes automated disaster recovery mechanisms.

## Automated Backups
The system automatically triggers a database snapshot every 24 hours.
- **Backup Location:** Configured via `BACKUP_PATH` (defaults to `backups/` in root).
- **Retention Policy:** Backups older than 7 days are automatically purged to manage disk space.
- **Implementation:** Uses filesystem-level snapshots for SQLite integrity.

To trigger a manual backup, ensure the environment is configured and call `performBackup()` from the `backup.service.ts` module.