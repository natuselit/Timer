import type { EnterpriseScheduleItem } from '../../../../entities/enterprise-schedule';
import type { LocalDateString } from '../../../../entities/shift';
import { getCalendarMonthRange } from '../../date-time';
import type { ShifterDatabase } from '../database';

export class EnterpriseScheduleRepository {
  constructor(private readonly db: ShifterDatabase) {}

  async importItems(items: EnterpriseScheduleItem[]): Promise<void> {
    await this.db.transaction('rw', this.db.enterpriseSchedule, async () => {
      await this.db.enterpriseSchedule.bulkPut(items);
    });
  }

  async getItemsByMonth(year: number, month: number): Promise<EnterpriseScheduleItem[]> {
    const { start, end } = getCalendarMonthRange({ year, month });

    return this.db.enterpriseSchedule.where('date').between(start, end, true, true).sortBy('date');
  }

  async getItemsBetween(
    start: LocalDateString,
    end: LocalDateString
  ): Promise<EnterpriseScheduleItem[]> {
    return this.db.enterpriseSchedule.where('date').between(start, end, true, true).sortBy('date');
  }

  async getDateBounds(): Promise<{ start: LocalDateString; end: LocalDateString } | null> {
    const [firstItem, lastItem] = await Promise.all([
      this.db.enterpriseSchedule.orderBy('date').first(),
      this.db.enterpriseSchedule.orderBy('date').last()
    ]);

    return firstItem && lastItem
      ? {
          start: firstItem.date,
          end: lastItem.date
        }
      : null;
  }

  async getItemById(id: string): Promise<EnterpriseScheduleItem | null> {
    return (await this.db.enterpriseSchedule.get(id)) ?? null;
  }

  async updateItem(item: EnterpriseScheduleItem): Promise<EnterpriseScheduleItem> {
    await this.db.enterpriseSchedule.put(item);

    return item;
  }
}
