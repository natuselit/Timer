import type { ShifterDatabase } from '../database';
import type {
  AppMetaRecord,
  ReviewedScheduleWarning
} from '../types';

export const SCHEDULE_WARNING_REVIEW_PREFIX = 'schedule-warning-review:';

export const toScheduleWarningReviewRecord = (
  review: ReviewedScheduleWarning
): AppMetaRecord => ({
  key: `${SCHEDULE_WARNING_REVIEW_PREFIX}${review.shiftId}`,
  value: review.fingerprint,
  updatedAt: review.reviewedAt
});

export const fromScheduleWarningReviewRecord = (
  record: AppMetaRecord
): ReviewedScheduleWarning | null => {
  if (!record.key.startsWith(SCHEDULE_WARNING_REVIEW_PREFIX)) {
    return null;
  }

  const shiftId = record.key.slice(SCHEDULE_WARNING_REVIEW_PREFIX.length);

  if (!shiftId || !record.value || !record.updatedAt) {
    return null;
  }

  return {
    shiftId,
    fingerprint: record.value,
    reviewedAt: record.updatedAt
  };
};

export class ScheduleWarningReviewRepository {
  constructor(private readonly db: ShifterDatabase) {}

  async getAll(): Promise<ReviewedScheduleWarning[]> {
    const records = await this.db.appMeta
      .where('key')
      .startsWith(SCHEDULE_WARNING_REVIEW_PREFIX)
      .toArray();

    return records
      .map(fromScheduleWarningReviewRecord)
      .filter((review): review is ReviewedScheduleWarning => review !== null);
  }

  async getByShiftIds(shiftIds: string[]): Promise<ReviewedScheduleWarning[]> {
    if (shiftIds.length === 0) {
      return [];
    }

    const records = await this.db.appMeta.bulkGet(
      shiftIds.map((shiftId) => `${SCHEDULE_WARNING_REVIEW_PREFIX}${shiftId}`)
    );

    return records
      .filter((record): record is AppMetaRecord => record !== undefined)
      .map(fromScheduleWarningReviewRecord)
      .filter((review): review is ReviewedScheduleWarning => review !== null);
  }

  async markReviewed(
    review: ReviewedScheduleWarning
  ): Promise<ReviewedScheduleWarning> {
    await this.db.appMeta.put(toScheduleWarningReviewRecord(review));

    return review;
  }

  async deleteByShiftId(shiftId: string): Promise<void> {
    await this.db.appMeta.delete(
      `${SCHEDULE_WARNING_REVIEW_PREFIX}${shiftId}`
    );
  }

  async clearAll(): Promise<void> {
    await this.db.appMeta
      .where('key')
      .startsWith(SCHEDULE_WARNING_REVIEW_PREFIX)
      .delete();
  }
}
