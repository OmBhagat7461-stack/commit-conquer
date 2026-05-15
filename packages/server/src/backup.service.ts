import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

/**
 * Configuration for automated backups.
 * In a production environment, these would be sourced from process.env.
 */
const BACKUP_DIR = process.env.BACKUP_PATH || path.join(__dirname, '../../../backups');
const RETENTION_DAYS = 7;

/**
 * Performs a database backup.
 * Note: This implementation assumes a SQLite-based storage as per the project structure.
 */
export async function performBackup(): Promise<string> {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(BACKUP_DIR, `db_backup_${timestamp}.sqlite`);
  const sourceDb = process.env.DB_PATH || path.join(__dirname, '../data/database.sqlite');

  try {
    // Perform a filesystem copy for SQLite backup
    await fs.promises.copyFile(sourceDb, backupFile);
    await cleanupOldBackups();
    return backupFile;
  } catch (error) {
    console.error('Backup failed:', error);
    throw new Error('Database backup failed');
  }
}

/**
 * Removes backups older than the retention period.
 */
async function cleanupOldBackups(): Promise<void> {
  const files = await fs.promises.readdir(BACKUP_DIR);
  const now = Date.now();
  const msPerDay = 24 * 60 * 60 * 1000;

  for (const file of files) {
    const filePath = path.join(BACKUP_DIR, file);
    const stats = await fs.promises.stat(filePath);
    if (now - stats.mtimeMs > RETENTION_DAYS * msPerDay) {
      await fs.promises.unlink(filePath);
    }
  }
}

/**
 * Initializes the backup scheduler.
 */
export function initBackupScheduler(): void {
  const ONE_DAY = 24 * 60 * 60 * 1000;
  setInterval(async () => {
    try {
      await performBackup();
      console.log('Automated backup completed successfully.');
    } catch (err) {
      console.error('Automated backup failed:', err);
    }
  }, ONE_DAY);
}