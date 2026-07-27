import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  schedule: vi.fn(),
  cancel: vi.fn(),
  getPending: vi.fn(),
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  createChannel: vi.fn(),
  checkExactNotificationSetting: vi.fn(),
  changeExactNotificationSetting: vi.fn(),
  removeAllDeliveredNotifications: vi.fn(),
  addListener: vi.fn()
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => 'android'
  }
}));

vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: mocks
}));

import {
  cancelActiveTicketNotification,
  rebuildScheduleNotifications,
  requestNotificationPermission,
  scheduleActiveTicketNotification
} from './notifications';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.schedule.mockResolvedValue({ notifications: [] });
  mocks.cancel.mockResolvedValue(undefined);
  mocks.getPending.mockResolvedValue({ notifications: [] });
  mocks.checkPermissions.mockResolvedValue({ display: 'granted' });
  mocks.requestPermissions.mockResolvedValue({ display: 'granted' });
  mocks.createChannel.mockResolvedValue(undefined);
  mocks.checkExactNotificationSetting.mockResolvedValue({ exact_alarm: 'denied' });
  mocks.changeExactNotificationSetting.mockResolvedValue({ exact_alarm: 'granted' });
});

describe('native notification adapter', () => {
  it('requests display permission, creates a channel and asks for exact alarms', async () => {
    await expect(requestNotificationPermission()).resolves.toBe(true);

    expect(mocks.requestPermissions).toHaveBeenCalledOnce();
    expect(mocks.createChannel).toHaveBeenCalledOnce();
    expect(mocks.changeExactNotificationSetting).toHaveBeenCalledOnce();
  });

  it('schedules no more than 60 future enterprise reminders', async () => {
    const items = Array.from({ length: 65 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 7, index + 1)).toISOString().slice(0, 10);

      return {
        id: `schedule-${index}`,
        date,
        shiftType: 'first',
        templateNameSnapshot: '1 зміна',
        plannedStartTime: '06:30',
        plannedEndTime: '14:30',
        enterpriseStartTime: '06:30',
        enterpriseEndTime: '14:30',
        skipped: false,
        sourceText: '',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z'
      };
    });

    await expect(
      rebuildScheduleNotifications({
        items,
        preferences: {
          enabled: true,
          shiftStart: { enabled: true, minutes: 15 },
          activeTicketEnd: { enabled: true, minutes: 10 },
          unfinishedShift: { enabled: true, minutes: 15 }
        },
        now: new Date('2026-07-01T00:00:00.000Z')
      })
    ).resolves.toBe(60);

    expect(mocks.schedule.mock.calls[0][0].notifications).toHaveLength(60);
  });

  it('schedules and cancels an active ticket reminder', async () => {
    const shift = {
      id: 'shift',
      date: '2099-07-01',
      type: 'first',
      plannedStartTime: '06:30',
      plannedEndTime: '14:30',
      startTime: '2099-07-01T06:30:00.000Z',
      endTime: null,
      baseHourlyRateSnapshot: 100,
      hourlyRateSnapshot: 100,
      gradeSnapshot: null,
      workTickets: [],
      coefficientMode: 'auto' as const,
      detectionMode: 'auto' as const,
      isAutoClosed: false,
      createdAt: '2099-07-01T06:30:00.000Z',
      updatedAt: '2099-07-01T06:30:00.000Z'
    };
    const ticket = {
      id: 'ticket',
      normPerEightHours: 50,
      startedAt: '2099-07-01T07:00:00.000Z',
      endedAt: null,
      actualQuantity: null,
      downtimeMinutes: 0,
      createdAt: '2099-07-01T07:00:00.000Z',
      updatedAt: '2099-07-01T07:00:00.000Z'
    };

    await scheduleActiveTicketNotification(shift, ticket, {
      enabled: true,
      shiftStart: { enabled: true, minutes: 15 },
      activeTicketEnd: { enabled: true, minutes: 10 },
      unfinishedShift: { enabled: true, minutes: 15 }
    });
    await cancelActiveTicketNotification(ticket.id);
    expect(mocks.schedule).toHaveBeenCalledOnce();
    expect(mocks.cancel).toHaveBeenCalledOnce();
  });
});
