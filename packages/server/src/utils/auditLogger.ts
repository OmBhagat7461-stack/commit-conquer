import fs from 'fs';
import path from 'path';

const AUDIT_LOG_PATH = process.env.AUDIT_LOG_FILE || path.join(__dirname, '../../audit.log');

export const logAdminAction = (adminId: string, action: string, resourceId: string, details: any) => {
  const entry = {
    timestamp: new Date().toISOString(),
    adminId,
    action,
    resourceId,
    details,
  };

  try {
    fs.appendFileSync(AUDIT_LOG_PATH, JSON.stringify(entry) + '\n');
  } catch (err) {
    console.error('Failed to write to audit log:', err);
  }
};