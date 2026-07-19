import { calculateSalaryBreakdown, type ISODateTimeString, type Shift } from '../../../entities/shift';

export type MonthShiftSummary = {
  totalAmount: number;
  shiftCount: number;
  totalMinutes: number;
};

export const calculateMonthShiftSummary = (
  shifts: Shift[],
  now?: ISODateTimeString
): MonthShiftSummary =>
  shifts.reduce<MonthShiftSummary>(
    (summary, shift) => {
      const endTime = shift.endTime ?? now;

      if (!endTime) {
        return summary;
      }

      const salary = calculateSalaryBreakdown({
        ...shift,
        endTime
      });

      return {
        totalAmount: summary.totalAmount + salary.totalAmount,
        shiftCount: summary.shiftCount + 1,
        totalMinutes: summary.totalMinutes + salary.totalMinutes
      };
    },
    {
      totalAmount: 0,
      shiftCount: 0,
      totalMinutes: 0
    }
  );
