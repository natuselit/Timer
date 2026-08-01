import type { ShifterDatabase } from '../local-db/database';
import { createBackup, serializeBackup, type ShifterBackup } from '../local-db/use-cases/backupUseCases';

export const downloadBackup = async (
  db: ShifterDatabase,
  exportedAt: string
): Promise<ShifterBackup> => {
  const backup = await createBackup(db, exportedAt);
  const blob = new Blob([serializeBackup(backup)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const datePart = backup.exportedAt.slice(0, 10);

  anchor.href = url;
  anchor.download = `shifter-backup-${datePart}.json`;
  anchor.hidden = true;
  document.body.append(anchor);

  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return backup;
};
