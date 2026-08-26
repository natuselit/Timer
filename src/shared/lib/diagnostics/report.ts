import { localDb } from '../local-db/database';
import { getDiagnosticLogs } from './diagnostics';
import type { DiagnosticReportV1 } from './types';

declare const __APP_VERSION__: string;

const getDisplayMode = (): 'standalone' | 'browser' =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(display-mode: standalone)').matches
    ? 'standalone'
    : 'browser';

const getTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
  } catch {
    return 'unknown';
  }
};

export const createDiagnosticReport = async (
  exportedAt = new Date().toISOString()
): Promise<DiagnosticReportV1> => ({
  schemaVersion: 1,
  exportedAt,
  app: {
    name: 'Облік часу',
    version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'unknown',
    databaseVersion: localDb.verno
  },
  environment: {
    userAgent: typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent,
    language: typeof navigator === 'undefined' ? 'unknown' : navigator.language,
    timezone: getTimezone(),
    online: typeof navigator === 'undefined' ? false : navigator.onLine,
    displayMode: getDisplayMode(),
    viewport: {
      width: typeof window === 'undefined' ? 0 : window.innerWidth,
      height: typeof window === 'undefined' ? 0 : window.innerHeight
    }
  },
  events: await getDiagnosticLogs()
});

export const serializeDiagnosticReport = (report: DiagnosticReportV1): string =>
  JSON.stringify(report, null, 2);

export const buildDiagnosticReportFileName = (exportedAt: string): string => {
  const datePart = exportedAt.slice(0, 10);
  const timePart = exportedAt.slice(11, 16).replace(':', '-');
  return `oblik-chasu-diagnostic-${datePart}_${timePart}.json`;
};

export const downloadDiagnosticReport = async (
  exportedAt = new Date().toISOString()
): Promise<DiagnosticReportV1> => {
  const report = await createDiagnosticReport(exportedAt);
  const blob = new Blob([serializeDiagnosticReport(report)], {
    type: 'application/json'
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = buildDiagnosticReportFileName(exportedAt);
  anchor.hidden = true;
  document.body.append(anchor);

  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return report;
};
