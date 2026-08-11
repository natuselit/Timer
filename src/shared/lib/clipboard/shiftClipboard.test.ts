import { describe, expect, it, vi } from 'vitest';
import type { Shift } from '../../../entities/shift';
import { copyTextToClipboard, formatShiftClipboardText } from './shiftClipboard';

const shift: Shift & { endTime: string } = {
  id: 'shift-1',
  date: '2026-07-24',
  type: 'first',
  detectionMode: 'auto',
  plannedStartTime: '06:30',
  plannedEndTime: '14:30',
  startTime: '2026-07-24T06:30:00.000+03:00',
  endTime: '2026-07-24T14:30:00.000+03:00',
  baseHourlyRateSnapshot: 100,
  hourlyRateSnapshot: 100,
  gradeSnapshot: null,
  workTickets: [],
  note: '',
  coefficientMode: 'auto',
  isAutoClosed: false,
  createdAt: '2026-07-24T06:30:00.000+03:00',
  updatedAt: '2026-07-24T14:30:00.000+03:00'
};

describe('formatShiftClipboardText', () => {
  it('formats surname, uppercase initial and actual times without a leading zero', () => {
    expect(
      formatShiftClipboardText(
        { employeeFirstName: ' андрій ', employeeLastName: ' Кухарчук ' },
        shift
      )
    ).toBe('Кухарчук А 6:30-14:30');
  });

  it('keeps a useful value for an old backup without a first name', () => {
    expect(
      formatShiftClipboardText(
        { employeeFirstName: '', employeeLastName: 'Кухарчук' },
        shift
      )
    ).toBe('Кухарчук 6:30-14:30');
  });
});

describe('copyTextToClipboard', () => {
  it('uses Clipboard API when it succeeds', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const legacyCopy = vi.fn(() => true);

    await expect(copyTextToClipboard('текст', { writeText, legacyCopy })).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('текст');
    expect(legacyCopy).not.toHaveBeenCalled();
  });

  it('falls back without throwing when Clipboard API rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    const legacyCopy = vi.fn(() => true);

    await expect(copyTextToClipboard('текст', { writeText, legacyCopy })).resolves.toBe(true);
    expect(legacyCopy).toHaveBeenCalledWith('текст');
  });
});
