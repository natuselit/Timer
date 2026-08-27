import { localDb } from '../local-db/database';
import { DiagnosticLogRepository } from '../local-db/repositories/diagnosticLogRepository';
import { normalizeDiagnosticError } from './normalize';
import {
  DIAGNOSTIC_EVENT_CODES,
  DIAGNOSTIC_SCREENS,
  type DiagnosticErrorCauseDetails,
  type DiagnosticErrorDetails,
  type DiagnosticEventCode,
  type DiagnosticLogRecord,
  type DiagnosticScreen
} from './types';

const EMERGENCY_STORAGE_KEY = 'oblik-chasu-diagnostic-fallback-v1';
const repository = new DiagnosticLogRepository(localDb);
const memoryRecords = new Map<string, DiagnosticLogRecord>();
const pendingWrites = new Set<Promise<void>>();
let seenErrorObjects = new WeakSet<object>();
const recentPrimitiveErrors = new Map<string, number>();
let globalDiagnosticsInstalled = false;
let isClearingDiagnostics = false;

const normalizeStoredCause = (
  value: unknown,
  depth = 0
): DiagnosticErrorCauseDetails | undefined => {
  if (!value || typeof value !== 'object' || depth >= 3) {
    return undefined;
  }

  const cause = value as Partial<DiagnosticErrorCauseDetails>;
  if (typeof cause.name !== 'string' || typeof cause.message !== 'string') {
    return undefined;
  }

  const nestedCause = normalizeStoredCause(cause.cause, depth + 1);

  return {
    name: cause.name.slice(0, 120),
    message: cause.message.slice(0, 1_000),
    ...(typeof cause.stack === 'string'
      ? { stack: cause.stack.slice(0, 4_000) }
      : {}),
    ...(nestedCause ? { cause: nestedCause } : {})
  };
};

const normalizeStoredError = (value: unknown): DiagnosticErrorDetails | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const error = value as Partial<DiagnosticErrorDetails>;
  if (typeof error.name !== 'string' || typeof error.message !== 'string') {
    return undefined;
  }

  const cause = normalizeStoredCause(error.cause);
  const stage =
    typeof error.stage === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(error.stage)
      ? error.stage
      : undefined;

  return {
    name: error.name,
    message: error.message,
    ...(typeof error.stack === 'string' ? { stack: error.stack } : {}),
    ...(typeof error.componentStack === 'string'
      ? { componentStack: error.componentStack }
      : {}),
    ...(stage ? { stage } : {}),
    ...(cause ? { cause } : {})
  };
};

const normalizeStoredRecord = (value: unknown): DiagnosticLogRecord | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Partial<DiagnosticLogRecord>;
  const isValid =
    typeof record.id === 'string' &&
    /^[A-Za-z0-9-]{8,80}$/.test(record.id) &&
    typeof record.timestamp === 'string' &&
    Number.isFinite(Date.parse(record.timestamp)) &&
    (record.kind === 'breadcrumb' || record.kind === 'error') &&
    DIAGNOSTIC_SCREENS.includes(record.screen as DiagnosticScreen) &&
    DIAGNOSTIC_EVENT_CODES.includes(record.code as DiagnosticEventCode);

  if (!isValid) {
    return null;
  }

  const error = normalizeStoredError(record.error);
  if (record.kind === 'error' && !error) {
    return null;
  }

  return {
    id: record.id!,
    timestamp: new Date(record.timestamp!).toISOString(),
    kind: record.kind!,
    screen: record.screen as DiagnosticScreen,
    code: record.code as DiagnosticEventCode,
    ...(error ? { error } : {})
  };
};

const readEmergencyRecords = (): DiagnosticLogRecord[] => {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const source = window.localStorage.getItem(EMERGENCY_STORAGE_KEY);
    const parsed: unknown = source ? JSON.parse(source) : [];
    return Array.isArray(parsed)
      ? parsed
          .map(normalizeStoredRecord)
          .filter((record): record is DiagnosticLogRecord => record !== null)
      : [];
  } catch {
    return [];
  }
};

const saveEmergencyRecord = (record: DiagnosticLogRecord): void => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const records = readEmergencyRecords();
    if (!records.some((storedRecord) => storedRecord.id === record.id)) {
      records.push(record);
      window.localStorage.setItem(EMERGENCY_STORAGE_KEY, JSON.stringify(records));
    }
  } catch {
    // Діагностика ніколи не повинна ламати основний сценарій застосунку.
  }
};

const createRecordId = (): string => {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
};

const persistRecord = (record: DiagnosticLogRecord): void => {
  if (isClearingDiagnostics) {
    return;
  }

  memoryRecords.set(record.id, record);

  const write = repository
    .add(record)
    .catch(() => saveEmergencyRecord(record))
    .finally(() => pendingWrites.delete(write));

  pendingWrites.add(write);
};

const shouldSkipDuplicateError = (error: unknown): boolean => {
  if ((typeof error === 'object' && error !== null) || typeof error === 'function') {
    const objectError = error as object;
    if (seenErrorObjects.has(objectError)) {
      return true;
    }

    seenErrorObjects.add(objectError);
    return false;
  }

  const fingerprint = `${typeof error}:${String(error)}`;
  const now = Date.now();
  const lastSeenAt = recentPrimitiveErrors.get(fingerprint);
  recentPrimitiveErrors.set(fingerprint, now);

  return lastSeenAt !== undefined && now - lastSeenAt < 1_000;
};

export const recordDiagnosticBreadcrumb = (
  code: DiagnosticEventCode,
  screen: DiagnosticScreen
): void => {
  persistRecord({
    id: createRecordId(),
    timestamp: new Date().toISOString(),
    kind: 'breadcrumb',
    screen,
    code
  });
};

export const recordDiagnosticError = (
  code: DiagnosticEventCode,
  screen: DiagnosticScreen,
  error: unknown,
  componentStack?: string
): void => {
  if (shouldSkipDuplicateError(error)) {
    return;
  }

  persistRecord({
    id: createRecordId(),
    timestamp: new Date().toISOString(),
    kind: 'error',
    screen,
    code,
    error: normalizeDiagnosticError(error, componentStack)
  });
};

export const flushDiagnosticLogs = async (): Promise<void> => {
  while (pendingWrites.size > 0) {
    await Promise.allSettled([...pendingWrites]);
  }
};

export const getDiagnosticLogs = async (): Promise<DiagnosticLogRecord[]> => {
  await flushDiagnosticLogs();

  let databaseRecords: DiagnosticLogRecord[] = [];
  try {
    databaseRecords = await repository.getAll();
  } catch {
    // Аварійний журнал і записи поточного сеансу залишаються доступними.
  }

  const mergedRecords = new Map<string, DiagnosticLogRecord>();
  const normalizedDatabaseRecords = databaseRecords
    .map(normalizeStoredRecord)
    .filter((record): record is DiagnosticLogRecord => record !== null);

  for (const record of [
    ...normalizedDatabaseRecords,
    ...readEmergencyRecords(),
    ...memoryRecords.values()
  ]) {
    mergedRecords.set(record.id, record);
  }

  return [...mergedRecords.values()].sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp)
  );
};

export const getDiagnosticLogCount = async (): Promise<number> =>
  (await getDiagnosticLogs()).length;

export const clearDiagnosticLogs = async (): Promise<void> => {
  isClearingDiagnostics = true;

  try {
    await flushDiagnosticLogs();
    await repository.clear();

    let storageError: unknown;
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(EMERGENCY_STORAGE_KEY);
      }
    } catch (error) {
      storageError = error;
    }

    memoryRecords.clear();
    seenErrorObjects = new WeakSet<object>();
    recentPrimitiveErrors.clear();

    if (storageError) {
      throw storageError;
    }
  } finally {
    isClearingDiagnostics = false;
  }
};

export const installGlobalDiagnostics = (): void => {
  if (typeof window === 'undefined' || globalDiagnosticsInstalled) {
    return;
  }

  globalDiagnosticsInstalled = true;

  window.addEventListener('error', (event) => {
    recordDiagnosticError(
      'app.global_error',
      'app',
      event.error ?? new Error(event.message || 'Невідома глобальна помилка.')
    );
  });

  window.addEventListener('unhandledrejection', (event) => {
    recordDiagnosticError('app.unhandled_rejection', 'app', event.reason);
  });

  recordDiagnosticBreadcrumb('app.launch', 'app');
};
