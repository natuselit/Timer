import type { ShifterDatabase } from '../database';

export const CALENDAR_TUTORIAL_SEEN_KEY = 'calendar-tutorial-seen-v1';

export class CalendarTutorialRepository {
  constructor(private readonly db: ShifterDatabase) {}

  async hasSeen(): Promise<boolean> {
    const record = await this.db.appMeta.get(CALENDAR_TUTORIAL_SEEN_KEY);

    return record?.value === 'true';
  }

  async markSeen(updatedAt: string): Promise<void> {
    await this.db.appMeta.put({
      key: CALENDAR_TUTORIAL_SEEN_KEY,
      value: 'true',
      updatedAt
    });
  }
}
