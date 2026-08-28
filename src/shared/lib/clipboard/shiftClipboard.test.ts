import { describe, expect, it, vi } from 'vitest';
import type { Shift } from '../../../entities/shift';
import {
  copyTextToClipboard,
  copyTextToClipboardFromUserGesture,
  formatShiftClipboardText,
  prepareTextClipboardWrite
} from './shiftClipboard';

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

  it('reports a failed legacy copy without throwing', async () => {
    const legacyCopy = vi.fn(() => {
      throw new Error('copy is blocked');
    });

    await expect(copyTextToClipboard('текст', { legacyCopy })).resolves.toBe(false);
  });
});

describe('copyTextToClipboardFromUserGesture', () => {
  it('uses the synchronous legacy copy while the iOS user gesture is active', async () => {
    const legacyCopy = vi.fn(() => true);
    const writeText = vi.fn().mockResolvedValue(undefined);

    await expect(
      copyTextToClipboardFromUserGesture('текст', { legacyCopy, writeText })
    ).resolves.toBe(true);
    expect(legacyCopy).toHaveBeenCalledWith('текст');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('uses writeText immediately when the legacy API is unavailable', async () => {
    const legacyCopy = vi.fn(() => false);
    const writeText = vi.fn().mockResolvedValue(undefined);

    await expect(
      copyTextToClipboardFromUserGesture('текст', { legacyCopy, writeText })
    ).resolves.toBe(true);
    expect(legacyCopy).toHaveBeenCalledWith('текст');
    expect(writeText).toHaveBeenCalledWith('текст');
  });
});

describe('prepareTextClipboardWrite', () => {
  it('starts the ClipboardItem write immediately and supplies text later', async () => {
    let clipboardData: Promise<string | Blob> | null = null;
    const createClipboardItem = vi.fn(
      (items: Record<string, string | Blob | PromiseLike<string | Blob>>) => {
        clipboardData = Promise.resolve(items['text/plain']);
        return {} as ClipboardItem;
      }
    );
    const write = vi.fn(async () => {
      const value = await clipboardData!;
      expect(value).toBeInstanceOf(Blob);
      expect(await (value as Blob).text()).toBe('Кухарчук А 6:30-14:30');
    });

    const preparedWrite = prepareTextClipboardWrite({ write, createClipboardItem });

    expect(preparedWrite).not.toBeNull();
    expect(write).toHaveBeenCalledTimes(1);

    await expect(preparedWrite!.complete('Кухарчук А 6:30-14:30')).resolves.toBe(true);
  });

  it('cancels a prepared write without changing the clipboard', async () => {
    let clipboardData: Promise<string | Blob> | null = null;
    const createClipboardItem = (
      items: Record<string, string | Blob | PromiseLike<string | Blob>>
    ) => {
      clipboardData = Promise.resolve(items['text/plain']);
      return {} as ClipboardItem;
    };
    const write = vi.fn(async () => {
      await clipboardData!;
    });

    const preparedWrite = prepareTextClipboardWrite({ write, createClipboardItem });
    preparedWrite!.cancel();

    await expect(preparedWrite!.complete('не копіювати')).resolves.toBe(false);
  });
});
