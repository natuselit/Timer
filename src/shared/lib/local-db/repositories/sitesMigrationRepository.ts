import type { ShifterDatabase } from '../database';

export const SITES_MIGRATION_STATUS_KEY = 'sites-migration-status-v1';

export type SitesMigrationStatus = 'pending' | 'skipped' | 'completed';

const isSavedStatus = (value: unknown): value is Exclude<SitesMigrationStatus, 'pending'> =>
  value === 'skipped' || value === 'completed';

export class SitesMigrationRepository {
  constructor(private readonly db: ShifterDatabase) {}

  async getStatus(): Promise<SitesMigrationStatus> {
    const record = await this.db.appMeta.get(SITES_MIGRATION_STATUS_KEY);

    return isSavedStatus(record?.value) ? record.value : 'pending';
  }

  async markSkipped(updatedAt: string): Promise<void> {
    await this.saveStatus('skipped', updatedAt);
  }

  async markCompleted(updatedAt: string): Promise<void> {
    await this.saveStatus('completed', updatedAt);
  }

  private async saveStatus(
    status: Exclude<SitesMigrationStatus, 'pending'>,
    updatedAt: string
  ): Promise<void> {
    await this.db.appMeta.put({
      key: SITES_MIGRATION_STATUS_KEY,
      value: status,
      updatedAt
    });
  }
}
