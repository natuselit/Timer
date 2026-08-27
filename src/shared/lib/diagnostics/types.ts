export const DIAGNOSTIC_SCREENS = [
  'app',
  'timer',
  'history',
  'analytics',
  'schedule',
  'settings',
  'onboarding',
  'migration'
] as const;

export type DiagnosticScreen = (typeof DIAGNOSTIC_SCREENS)[number];

export const DIAGNOSTIC_EVENT_CODES = [
  'app.launch',
  'app.ready',
  'app.settings_load_failed',
  'app.react_render_failed',
  'app.global_error',
  'app.unhandled_rejection',
  'navigation.changed',
  'timer.load_failed',
  'timer.shift_start_started',
  'timer.shift_start_completed',
  'timer.shift_start_failed',
  'timer.shift_finish_started',
  'timer.shift_finish_completed',
  'timer.shift_finish_failed',
  'timer.incognito_failed',
  'timer.note_save_failed',
  'ticket.create_started',
  'ticket.create_completed',
  'ticket.create_failed',
  'ticket.downtime_failed',
  'ticket.complete_failed',
  'ticket.update_failed',
  'ticket.delete_failed',
  'history.load_failed',
  'history.save_started',
  'history.save_completed',
  'history.save_failed',
  'history.delete_started',
  'history.delete_completed',
  'history.delete_failed',
  'analytics.load_failed',
  'schedule.load_failed',
  'schedule.pdf_read_started',
  'schedule.pdf_read_completed',
  'schedule.pdf_read_failed',
  'schedule.import_started',
  'schedule.import_completed',
  'schedule.import_failed',
  'schedule.sync_failed',
  'settings.save_started',
  'settings.save_completed',
  'settings.save_failed',
  'settings.theme_failed',
  'settings.incognito_failed',
  'settings.recalculate_failed',
  'backup.export_started',
  'backup.export_completed',
  'backup.export_failed',
  'backup.import_started',
  'backup.import_completed',
  'backup.import_failed',
  'data.clear_shifts_started',
  'data.clear_shifts_completed',
  'data.clear_shifts_failed',
  'data.clear_all_started',
  'data.clear_all_failed',
  'migration.import_started',
  'migration.import_completed',
  'migration.import_failed',
  'migration.status_write_failed',
  'pwa.install_failed',
  'pwa.update_failed'
] as const;

export type DiagnosticEventCode = (typeof DIAGNOSTIC_EVENT_CODES)[number];

export type DiagnosticErrorCauseDetails = {
  name: string;
  message: string;
  stack?: string;
  cause?: DiagnosticErrorCauseDetails;
};

export type DiagnosticErrorDetails = {
  name: string;
  message: string;
  stack?: string;
  componentStack?: string;
  stage?: string;
  cause?: DiagnosticErrorCauseDetails;
};

export type DiagnosticLogRecord = {
  id: string;
  timestamp: string;
  kind: 'breadcrumb' | 'error';
  screen: DiagnosticScreen;
  code: DiagnosticEventCode;
  error?: DiagnosticErrorDetails;
};

export type DiagnosticReportV1 = {
  schemaVersion: 1;
  exportedAt: string;
  app: {
    name: 'Облік часу';
    version: string;
    databaseVersion: number;
  };
  environment: {
    userAgent: string;
    language: string;
    timezone: string;
    online: boolean;
    displayMode: 'standalone' | 'browser';
    viewport: {
      width: number;
      height: number;
    };
  };
  events: DiagnosticLogRecord[];
};
