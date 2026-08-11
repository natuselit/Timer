import type { ShifterDatabase } from '../database';
import type {
  AppMetaRecord,
  ConfirmedSaturdayDoubleRateMonth
} from '../types';

export const SATURDAY_DOUBLE_RATE_PREFIX = 'overtime-saturday-x2:';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

const assertMonth = (month: string): void => {
  if (!MONTH_PATTERN.test(month)) {
    throw new Error('Місяць має бути у форматі РРРР-ММ.');
  }
};

const isSaturday = (date: string): boolean => {
  const [year, month, day] = date.split('-').map(Number);

  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 6;
};

export const toSaturdayDoubleRateRecord = (
  confirmation: ConfirmedSaturdayDoubleRateMonth
): AppMetaRecord => ({
  key: `${SATURDAY_DOUBLE_RATE_PREFIX}${confirmation.month}`,
  value: 'true',
  updatedAt: confirmation.confirmedAt
});

export const fromSaturdayDoubleRateRecord = (
  record: AppMetaRecord
): ConfirmedSaturdayDoubleRateMonth | null => {
  if (!record.key.startsWith(SATURDAY_DOUBLE_RATE_PREFIX) || record.value !== 'true') {
    return null;
  }

  const month = record.key.slice(SATURDAY_DOUBLE_RATE_PREFIX.length);

  if (!MONTH_PATTERN.test(month) || Number.isNaN(new Date(record.updatedAt).getTime())) {
    return null;
  }

  return { month, confirmedAt: record.updatedAt };
};

export class OvertimeCoefficientRepository {
  constructor(private readonly db: ShifterDatabase) {}

  async getAllConfirmedMonths(): Promise<ConfirmedSaturdayDoubleRateMonth[]> {
    const records = await this.db.appMeta
      .where('key')
      .startsWith(SATURDAY_DOUBLE_RATE_PREFIX)
      .toArray();

    return records
      .map(fromSaturdayDoubleRateRecord)
      .filter(
        (confirmation): confirmation is ConfirmedSaturdayDoubleRateMonth =>
          confirmation !== null
      )
      .sort((left, right) => left.month.localeCompare(right.month));
  }

  async isDoubleRateConfirmed(month: string): Promise<boolean> {
    assertMonth(month);
    const record = await this.db.appMeta.get(`${SATURDAY_DOUBLE_RATE_PREFIX}${month}`);

    return record?.value === 'true';
  }

  async confirmDoubleRate(
    month: string,
    confirmedAt: string
  ): Promise<{ confirmation: ConfirmedSaturdayDoubleRateMonth; updatedShiftCount: number }> {
    assertMonth(month);

    if (Number.isNaN(new Date(confirmedAt).getTime())) {
      throw new Error('Час підтвердження має бути валідною датою.');
    }

    const confirmation = { month, confirmedAt };
    let updatedShiftCount = 0;

    await this.db.transaction('rw', this.db.shifts, this.db.appMeta, async () => {
      await this.db.shifts
        .where('date')
        .between(`${month}-01`, `${month}-31`, true, true)
        .modify((shift) => {
          if (isSaturday(shift.date) && shift.coefficientMode === 'x1.5') {
            shift.coefficientMode = 'x2';
            shift.updatedAt = confirmedAt;
            updatedShiftCount += 1;
          }
        });

      await this.db.appMeta.put(toSaturdayDoubleRateRecord(confirmation));
    });

    return { confirmation, updatedShiftCount };
  }
}
