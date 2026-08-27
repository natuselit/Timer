import type {
  DiagnosticErrorCauseDetails,
  DiagnosticErrorDetails
} from './types';

const MAX_CAUSE_DEPTH = 3;
const MAX_CAUSE_MESSAGE_LENGTH = 1_000;
const MAX_CAUSE_STACK_LENGTH = 4_000;
const DIAGNOSTIC_STAGE_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;
const URL_PATTERN = /https?:\/\/[^\s)\]}]+/giu;
const EMAIL_PATTERN = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/giu;
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu;
const ISO_DATE_PATTERN =
  /\b\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?\b/giu;
const LOCAL_DATE_PATTERN = /\b\d{1,2}[./]\d{1,2}[./]\d{4}\b/gu;

const sanitizeCauseText = (value: string, maxLength: number): string =>
  value
    .normalize('NFC')
    .replace(URL_PATTERN, '[url]')
    .replace(EMAIL_PATTERN, '[email]')
    .replace(UUID_PATTERN, '[id]')
    .replace(ISO_DATE_PATTERN, '[date]')
    .replace(LOCAL_DATE_PATTERN, '[date]')
    .slice(0, maxLength);

const formatNonErrorValue = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' && Object.is(value, -0)) {
    return '-0';
  }

  try {
    return String(value);
  } catch {
    return 'Не вдалося перетворити відхилене значення на текст.';
  }
};

const normalizeErrorCause = (
  cause: unknown,
  depth: number,
  seen: Set<object>
): DiagnosticErrorCauseDetails | undefined => {
  if (cause === undefined || depth >= MAX_CAUSE_DEPTH) {
    return undefined;
  }

  if (!(cause instanceof Error)) {
    return {
      name: 'NonErrorCause',
      message: sanitizeCauseText(
        formatNonErrorValue(cause),
        MAX_CAUSE_MESSAGE_LENGTH
      )
    };
  }

  if (seen.has(cause)) {
    return {
      name: 'CircularCause',
      message: 'Ланцюжок причини містить циклічне посилання.'
    };
  }

  seen.add(cause);
  const nestedCause = normalizeErrorCause(cause.cause, depth + 1, seen);

  return {
    name: sanitizeCauseText(cause.name || 'Error', 120),
    message: sanitizeCauseText(
      cause.message || 'Невідома первинна помилка.',
      MAX_CAUSE_MESSAGE_LENGTH
    ),
    ...(typeof cause.stack === 'string'
      ? { stack: sanitizeCauseText(cause.stack, MAX_CAUSE_STACK_LENGTH) }
      : {}),
    ...(nestedCause ? { cause: nestedCause } : {})
  };
};

const getDiagnosticStage = (error: Error): string | undefined => {
  const stage = 'stage' in error ? error.stage : undefined;
  return typeof stage === 'string' && DIAGNOSTIC_STAGE_PATTERN.test(stage)
    ? stage
    : undefined;
};

export const normalizeDiagnosticError = (
  error: unknown,
  componentStack?: string
): DiagnosticErrorDetails => {
  if (!(error instanceof Error)) {
    return {
      name: 'NonErrorRejection',
      message: formatNonErrorValue(error),
      ...(componentStack !== undefined ? { componentStack } : {})
    };
  }

  const stage = getDiagnosticStage(error);
  const cause = normalizeErrorCause(error.cause, 0, new Set([error]));

  return {
    name: error.name,
    message: error.message,
    ...(typeof error.stack === 'string' ? { stack: error.stack } : {}),
    ...(componentStack !== undefined ? { componentStack } : {}),
    ...(stage ? { stage } : {}),
    ...(cause ? { cause } : {})
  };
};
