import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import {
  LocalNotifications,
  type LocalNotificationActionPerformed,
  type LocalNotificationSchema
} from '@capacitor/local-notifications';
import type { EnterpriseScheduleItem } from '../../../entities/enterprise-schedule';
import type { NotificationPreferences } from '../../../entities/settings';
import { getPlannedShiftWindow, type Shift, type WorkTicket } from '../../../entities/shift';

const WORK_NOTIFICATION_SCOPE = 'shifter-work';
const WORK_CHANNEL_ID = 'shifter-work-reminders';

export const isNativePlatform = (): boolean => Capacitor.isNativePlatform();

const hashNotificationId = (value: string): number => {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }

  return Math.abs(hash || 1);
};

const getNotificationId = (
  kind: 'schedule' | 'ticket' | 'shift',
  entityId: string
): number => hashNotificationId(`${kind}:${entityId}`);

const createLocalDate = (date: string, time: string): Date => {
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);

  return new Date(year, month - 1, day, hours, minutes, 0, 0);
};

const getPlannedEndDate = (shift: Shift): Date =>
  new Date(
    getPlannedShiftWindow(shift.date, shift.templateId ?? shift.type, shift.startTime, {
      startTime: shift.plannedStartTime,
      endTime: shift.plannedEndTime
    }).plannedEnd
  );

const cancelByIds = async (ids: number[]): Promise<void> => {
  if (!isNativePlatform() || ids.length === 0) {
    return;
  }

  await LocalNotifications.cancel({
    notifications: ids.map((id) => ({ id }))
  });
};

export const getNotificationPermission = async (): Promise<
  'unavailable' | 'prompt' | 'prompt-with-rationale' | 'granted' | 'denied'
> => {
  if (!isNativePlatform()) {
    return 'unavailable';
  }

  const result = await LocalNotifications.checkPermissions();
  return result.display;
};

export const requestNotificationPermission = async (): Promise<boolean> => {
  if (!isNativePlatform()) {
    return false;
  }

  const permission = await LocalNotifications.requestPermissions();

  if (permission.display !== 'granted') {
    return false;
  }

  if (Capacitor.getPlatform() === 'android') {
    await LocalNotifications.createChannel({
      id: WORK_CHANNEL_ID,
      name: 'Робочі нагадування',
      description: 'Початок, тікети та завершення зміни',
      importance: 4,
      visibility: 1,
      vibration: true
    });
    const exactAlarm = await LocalNotifications.checkExactNotificationSetting();

    if (exactAlarm.exact_alarm !== 'granted') {
      await LocalNotifications.changeExactNotificationSetting();
    }
  }

  return true;
};

const cancelWorkNotifications = async (
  kind?: 'schedule' | 'ticket' | 'shift'
): Promise<void> => {
  if (!isNativePlatform()) {
    return;
  }

  const pending = await LocalNotifications.getPending();
  const notifications = pending.notifications.filter(
    (notification) =>
      notification.extra?.scope === WORK_NOTIFICATION_SCOPE &&
      (!kind || notification.extra?.kind === kind)
  );

  if (notifications.length > 0) {
    await LocalNotifications.cancel({
      notifications: notifications.map(({ id }) => ({ id }))
    });
  }
};

export const rebuildScheduleNotifications = async ({
  items,
  preferences,
  now = new Date()
}: {
  items: EnterpriseScheduleItem[];
  preferences: NotificationPreferences;
  now?: Date;
}): Promise<number> => {
  if (!isNativePlatform()) {
    return 0;
  }

  await cancelWorkNotifications('schedule');

  if (
    !preferences.enabled ||
    !preferences.shiftStart.enabled ||
    (await getNotificationPermission()) !== 'granted'
  ) {
    return 0;
  }

  const notifications: LocalNotificationSchema[] = items
    .map((item) => {
      const at = createLocalDate(item.date, item.enterpriseStartTime);
      at.setMinutes(at.getMinutes() - preferences.shiftStart.minutes);

      return {
        item,
        at
      };
    })
    .filter(({ at }) => at.getTime() > now.getTime())
    .sort((left, right) => left.at.getTime() - right.at.getTime())
    .slice(0, 60)
    .map(({ item, at }) => ({
      id: getNotificationId('schedule', item.id),
      title: 'Скоро початок зміни',
      body: `${item.templateNameSnapshot ?? 'Зміна'} о ${item.enterpriseStartTime}`,
      channelId: WORK_CHANNEL_ID,
      schedule: {
        at,
        allowWhileIdle: true
      },
      extra: {
        scope: WORK_NOTIFICATION_SCOPE,
        page: 'timer',
        kind: 'schedule',
        entityId: item.id
      }
    }));

  if (notifications.length > 0) {
    await LocalNotifications.schedule({ notifications });
  }

  return notifications.length;
};

export const scheduleActiveShiftNotification = async (
  shift: Shift,
  preferences: NotificationPreferences
): Promise<void> => {
  if (
    !isNativePlatform() ||
    !preferences.enabled ||
    !preferences.unfinishedShift.enabled
  ) {
    return;
  }

  const at = getPlannedEndDate(shift);
  at.setMinutes(at.getMinutes() + preferences.unfinishedShift.minutes);

  if (at.getTime() <= Date.now()) {
    return;
  }

  await LocalNotifications.schedule({
    notifications: [
      {
        id: getNotificationId('shift', shift.id),
        title: 'Зміна ще не завершена',
        body: 'Перевірте таймер і натисніть «Пішов», якщо роботу завершено.',
        channelId: WORK_CHANNEL_ID,
        schedule: { at, allowWhileIdle: true },
        extra: {
          scope: WORK_NOTIFICATION_SCOPE,
          page: 'timer',
          kind: 'shift',
          entityId: shift.id
        }
      }
    ]
  });
};

export const cancelActiveShiftNotification = (shiftId: string): Promise<void> =>
  cancelByIds([getNotificationId('shift', shiftId)]);

export const scheduleActiveTicketNotification = async (
  shift: Shift,
  ticket: WorkTicket,
  preferences: NotificationPreferences
): Promise<void> => {
  if (
    !isNativePlatform() ||
    !preferences.enabled ||
    !preferences.activeTicketEnd.enabled
  ) {
    return;
  }

  const at = getPlannedEndDate(shift);
  at.setMinutes(at.getMinutes() - preferences.activeTicketEnd.minutes);

  if (at.getTime() <= Date.now()) {
    return;
  }

  await LocalNotifications.schedule({
    notifications: [
      {
        id: getNotificationId('ticket', ticket.id),
        title: 'Активний тікет',
        body: 'До планового завершення зміни лишилося небагато часу.',
        channelId: WORK_CHANNEL_ID,
        schedule: { at, allowWhileIdle: true },
        extra: {
          scope: WORK_NOTIFICATION_SCOPE,
          page: 'timer',
          kind: 'ticket',
          entityId: ticket.id
        }
      }
    ]
  });
};

export const cancelActiveTicketNotification = (ticketId: string): Promise<void> =>
  cancelByIds([getNotificationId('ticket', ticketId)]);

export const clearAllNotifications = async (): Promise<void> => {
  if (!isNativePlatform()) {
    return;
  }

  await cancelWorkNotifications();
  await LocalNotifications.removeAllDeliveredNotifications();
};

export const listenForWorkNotificationNavigation = async (
  onTimerRequested: () => void
): Promise<PluginListenerHandle | null> => {
  if (!isNativePlatform()) {
    return null;
  }

  return LocalNotifications.addListener(
    'localNotificationActionPerformed',
    (event: LocalNotificationActionPerformed) => {
      if (
        event.notification.extra?.scope === WORK_NOTIFICATION_SCOPE &&
        event.notification.extra?.page === 'timer'
      ) {
        onTimerRequested();
      }
    }
  );
};
