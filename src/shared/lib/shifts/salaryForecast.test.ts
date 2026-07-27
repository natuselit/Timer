import { describe, expect, it } from 'vitest';
import type { Shift } from '../../../entities/shift';
import { calculateSalaryForecast } from './salaryForecast';

const makeCompletedShifts = (count: number): Shift[] =>
  Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(2026, 6, 14 - index));
    const dateKey = date.toISOString().slice(0, 10);

    return {
      id: `shift-${index}`,
      date: dateKey,
      type: 'short',
      templateId: 'short',
      templateNameSnapshot: 'Коротка',
      detectionMode: 'manual',
      plannedStartTime: '06:00',
      plannedEndTime: '07:00',
      startTime: `${dateKey}T06:00:00.000Z`,
      endTime: `${dateKey}T07:00:00.000Z`,
      baseHourlyRateSnapshot: index === 31 ? 600 : 60,
      hourlyRateSnapshot: index === 31 ? 600 : 60,
      gradeSnapshot: null,
      workTickets: [],
      coefficientMode: 'x1',
      isAutoClosed: false,
      createdAt: `${dateKey}T06:00:00.000Z`,
      updatedAt: `${dateKey}T07:00:00.000Z`
    };
  });

const settings = {
  monthlySalary: 10_000,
  monthlyBonus: 500,
  currentGrade: 1 as const,
  gradeSalaryBonusPercents: [10, 10, 10, 10] as [number, number, number, number]
};

describe('salary forecast', () => {
  it('shows progress with 30 completed shifts', () => {
    const forecast = calculateSalaryForecast({
      shifts: makeCompletedShifts(30),
      enterpriseSchedule: [],
      settings,
      now: '2026-07-15T12:00:00.000Z'
    });

    expect(forecast.eligible).toBe(false);
    expect(forecast.completedShiftCount).toBe(30);
    expect(forecast.totalAmount).toBeNull();
  });

  it('enables forecast at exactly 31 shifts and uses imported future dates', () => {
    const forecast = calculateSalaryForecast({
      shifts: makeCompletedShifts(31),
      enterpriseSchedule: [
        {
          id: 'schedule-1',
          date: '2026-07-20',
          shiftType: 'first',
          plannedStartTime: '06:30',
          plannedEndTime: '14:30',
          enterpriseStartTime: '06:30',
          enterpriseEndTime: '14:30',
          skipped: false,
          sourceText: '',
          createdAt: '2026-07-01T00:00:00.000Z',
          updatedAt: '2026-07-01T00:00:00.000Z'
        }
      ],
      settings,
      now: '2026-07-15T12:00:00.000Z'
    });

    expect(forecast.eligible).toBe(true);
    expect(forecast.historicalAverage).toBe(60);
    expect(forecast.futureShiftCount).toBe(1);
    expect(forecast.futureSource).toBe('enterprise-schedule');
  });

  it('uses only the latest 31 of 32 completed shifts', () => {
    const forecast = calculateSalaryForecast({
      shifts: makeCompletedShifts(32),
      enterpriseSchedule: [],
      settings,
      now: '2026-07-15T12:00:00.000Z'
    });

    expect(forecast.eligible).toBe(true);
    expect(forecast.historicalAverage).toBe(60);
  });

  it('falls back to future weekdays when there is no imported schedule', () => {
    const forecast = calculateSalaryForecast({
      shifts: makeCompletedShifts(31),
      enterpriseSchedule: [],
      settings,
      now: '2026-07-15T12:00:00.000Z'
    });

    expect(forecast.futureSource).toBe('weekdays');
    expect(forecast.futureShiftCount).toBeGreaterThan(0);
  });
});
