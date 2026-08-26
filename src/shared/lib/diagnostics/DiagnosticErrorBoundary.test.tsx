// @vitest-environment jsdom

import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearDiagnosticLogs,
  flushDiagnosticLogs,
  getDiagnosticLogs
} from './diagnostics';
import { DiagnosticErrorBoundary } from './DiagnosticErrorBoundary';

function BrokenContent(): never {
  throw new Error('Render failed');
}

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await clearDiagnosticLogs();
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await clearDiagnosticLogs();
});

describe('DiagnosticErrorBoundary', () => {
  it('shows recovery actions and stores the React error', async () => {
    render(
      <DiagnosticErrorBoundary>
        <BrokenContent />
      </DiagnosticErrorBoundary>
    );

    expect(screen.getByRole('heading', { name: 'Сталася помилка' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Зберегти звіт' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Перезапустити' })).toBeTruthy();

    await flushDiagnosticLogs();
    await waitFor(async () => {
      expect((await getDiagnosticLogs()).map((record) => record.code)).toContain(
        'app.react_render_failed'
      );
    });
  });
});
