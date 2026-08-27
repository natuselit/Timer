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

describe('diagnostic error fidelity', () => {
  it('keeps complete error fields without redaction or length limits', async () => {
    const privateFragment =
      'Артем Кухарчук, artem@example.com, 2026-08-25, ' +
      '550e8400-e29b-41d4-a716-446655440000, зарплата 50800, ' +
      'https://example.com/a?q=secret';
    const message = `${privateFragment}\n${'довгий-фрагмент-'.repeat(700)}`;
    const stack = `Custom Error / 42: ${message}\n    at save (${privateFragment}:123:45)`;
    const componentStack = `\n    at SensitiveComponent (${privateFragment})`;
    const error = new Error(message);
    error.name = 'Custom Error / 42';
    error.stack = stack;

    recordDiagnosticBreadcrumb('navigation.changed', 'settings');
    recordDiagnosticError(
      'backup.import_failed',
      'settings',
      error,
      componentStack
    );

    const report = await createDiagnosticReport('2026-08-26T12:30:00.000Z');
    const source = serializeDiagnosticReport(report);
    const errorRecord = report.events.find((record) => record.kind === 'error');

    expect(report.schemaVersion).toBe(1);
    expect(report.app.databaseVersion).toBe(8);
    expect(report.events).toHaveLength(2);
    expect(errorRecord?.error).toEqual({
      name: 'Custom Error / 42',
      message,
      stack,
      componentStack
    });
    expect(source).toContain('Артем Кухарчук');
    expect(source).toContain('q=secret');
    expect(errorRecord?.error?.message.length).toBeGreaterThan(10_000);
  });

  it('keeps a complete string used as a non-Error rejection reason', async () => {
    const rejection = `rejected:https://example.com/?token=secret:${'x'.repeat(12_000)}`;

    recordDiagnosticError('app.unhandled_rejection', 'app', rejection);
    await flushDiagnosticLogs();

    expect((await getDiagnosticLogs())[0]?.error).toEqual({
      name: 'NonErrorRejection',
      message: rejection
    });
  });

  it('records a safe stage and redacted nested cause chain', async () => {
    const nestedCause = new TypeError(
      'Worker failed for worker@example.com at https://example.com/private.pdf on 27.08.2026'
    );
    nestedCause.stack =
      'TypeError: worker@example.com\n    at https://example.com/private.pdf:123:45';
    const rootCause = new Error(
      'PDF engine rejected 550e8400-e29b-41d4-a716-446655440000',
      { cause: nestedCause }
    );
    const error = Object.assign(new Error('Не вдалося прочитати PDF.', { cause: rootCause }), {
      stage: 'document-open'
    });

    recordDiagnosticError('schedule.pdf_read_failed', 'schedule', error);

    const report = await createDiagnosticReport('2026-08-27T06:00:00.000Z');
    const details = report.events[0]?.error;
    const source = serializeDiagnosticReport(report);

    expect(details?.stage).toBe('document-open');
    expect(details?.cause).toMatchObject({
      name: 'Error',
      message: 'PDF engine rejected [id]',
      cause: {
        name: 'TypeError',
        message: 'Worker failed for [email] at [url] on [date]'
      }
    });
    expect(source).not.toContain('worker@example.com');
    expect(source).not.toContain('private.pdf');
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
