// @vitest-environment jsdom

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiagnosticLogRepository } from '../local-db/repositories/diagnosticLogRepository';
import {
  clearDiagnosticLogs,
  flushDiagnosticLogs,
  getDiagnosticLogs,
  installGlobalDiagnostics,
  recordDiagnosticBreadcrumb,
  recordDiagnosticError
} from './diagnostics';
import {
  buildDiagnosticReportFileName,
  createDiagnosticReport,
  serializeDiagnosticReport
} from './report';
import { sanitizeDiagnosticText } from './sanitize';

beforeEach(async () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }))
  );
  await clearDiagnosticLogs();
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await clearDiagnosticLogs();
});

describe('diagnostic privacy', () => {
  it('redacts user fragments, contacts, dates, identifiers, URLs and long numbers', () => {
    const source =
      'Помилка для «Артем Кухарчук», artem@example.com, 2026-08-25, ' +
      '550e8400-e29b-41d4-a716-446655440000, зарплата 50800, https://example.com/a?q=secret';
    const sanitized = sanitizeDiagnosticText(source, 1_000);

    expect(sanitized).not.toContain('Артем Кухарчук');
    expect(sanitized).not.toContain('artem@example.com');
    expect(sanitized).not.toContain('2026-08-25');
    expect(sanitized).not.toContain('550e8400-e29b-41d4-a716-446655440000');
    expect(sanitized).not.toContain('50800');
    expect(sanitized).not.toContain('q=secret');
  });

  it('exports only sanitized errors and fixed event context', async () => {
    recordDiagnosticBreadcrumb('navigation.changed', 'settings');
    recordDiagnosticError(
      'backup.import_failed',
      'settings',
      new Error('Файл «Артем Кухарчук» за 2026-08-25 має ID 550e8400-e29b-41d4-a716-446655440000')
    );

    const report = await createDiagnosticReport('2026-08-26T12:30:00.000Z');
    const source = serializeDiagnosticReport(report);

    expect(report.schemaVersion).toBe(1);
    expect(report.app.databaseVersion).toBe(8);
    expect(report.events).toHaveLength(2);
    expect(source).not.toContain('Артем Кухарчук');
    expect(source).not.toContain('2026-08-25');
    expect(source).not.toContain('550e8400-e29b-41d4-a716-446655440000');
  });
});

describe('diagnostic persistence', () => {
  it('does not duplicate the same Error object', async () => {
    const error = new Error('IndexedDB unavailable');

    recordDiagnosticError('app.settings_load_failed', 'app', error);
    recordDiagnosticError('app.settings_load_failed', 'app', error);
    await flushDiagnosticLogs();

    expect(await getDiagnosticLogs()).toHaveLength(1);
  });

  it('keeps an emergency copy when IndexedDB logging fails', async () => {
    vi.spyOn(DiagnosticLogRepository.prototype, 'add').mockRejectedValueOnce(
      new Error('IndexedDB unavailable')
    );

    recordDiagnosticError(
      'app.settings_load_failed',
      'app',
      new Error('Settings read failed')
    );
    await flushDiagnosticLogs();

    expect(window.localStorage.length).toBe(1);
    expect(await getDiagnosticLogs()).toHaveLength(1);
  });

  it('clears database, emergency and in-memory records only when requested', async () => {
    recordDiagnosticBreadcrumb('app.launch', 'app');
    recordDiagnosticBreadcrumb('app.ready', 'app');
    await flushDiagnosticLogs();
    expect(await getDiagnosticLogs()).toHaveLength(2);

    await clearDiagnosticLogs();
    expect(await getDiagnosticLogs()).toEqual([]);
    expect(window.localStorage.length).toBe(0);
  });

  it('captures global errors and unhandled rejections', async () => {
    installGlobalDiagnostics();
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('render failed') }));
    window.dispatchEvent(
      Object.assign(new Event('unhandledrejection'), {
        reason: new Error('promise failed')
      })
    );
    await flushDiagnosticLogs();

    const codes = (await getDiagnosticLogs()).map((record) => record.code);
    expect(codes).toContain('app.launch');
    expect(codes).toContain('app.global_error');
    expect(codes).toContain('app.unhandled_rejection');
  });
});

describe('diagnostic report naming', () => {
  it('uses a safe timestamped filename without employee data', () => {
    expect(buildDiagnosticReportFileName('2026-08-26T14:05:00.000+03:00')).toBe(
      'oblik-chasu-diagnostic-2026-08-26_14-05.json'
    );
  });
});
