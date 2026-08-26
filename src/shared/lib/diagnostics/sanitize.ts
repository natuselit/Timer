import type { DiagnosticErrorDetails } from './types';

const URL_PATTERN = /https?:\/\/[^\s)\]}]+/giu;
const EMAIL_PATTERN = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/giu;
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu;
const ISO_DATE_PATTERN =
  /\b\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?\b/giu;
const LOCAL_DATE_PATTERN = /\b\d{1,2}[./]\d{1,2}[./]\d{4}\b/gu;
const QUOTED_FRAGMENT_PATTERN = /(["'«“])[^\n"'»”]{2,160}(["'»”])/gu;
const LONG_NUMBER_PATTERN = /\b\d{3,}(?:[.,]\d+)?\b/gu;

export const sanitizeDiagnosticText = (value: string, maxLength: number): string =>
  value
    .normalize('NFC')
    .replace(URL_PATTERN, '[url]')
    .replace(EMAIL_PATTERN, '[email]')
    .replace(UUID_PATTERN, '[id]')
    .replace(ISO_DATE_PATTERN, '[date]')
    .replace(LOCAL_DATE_PATTERN, '[date]')
    .replace(QUOTED_FRAGMENT_PATTERN, '$1[fragment]$2')
    .replace(LONG_NUMBER_PATTERN, '[number]')
    .slice(0, maxLength);

const sanitizeErrorName = (value: string): string =>
  value.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 120) || 'Error';

const getNonErrorMessage = (error: unknown): string => {
  if (typeof error === 'string') {
    return sanitizeDiagnosticText(error, 1_000);
  }

  const valueType = error === null ? 'null' : typeof error;
  return `Відхилено значенням типу ${valueType}.`;
};

export const normalizeDiagnosticError = (
  error: unknown,
  componentStack?: string
): DiagnosticErrorDetails => {
  if (!(error instanceof Error)) {
    return {
      name: 'NonErrorRejection',
      message: getNonErrorMessage(error),
      ...(componentStack
        ? { componentStack: sanitizeDiagnosticText(componentStack, 4_000) }
        : {})
    };
  }

  const stackLines = typeof error.stack === 'string' ? error.stack.split('\n').slice(1) : [];
  const stack = sanitizeDiagnosticText(stackLines.join('\n'), 8_000);

  return {
    name: sanitizeErrorName(error.name),
    message: sanitizeDiagnosticText(error.message || 'Невідома помилка.', 1_000),
    ...(stack ? { stack } : {}),
    ...(componentStack
      ? { componentStack: sanitizeDiagnosticText(componentStack, 4_000) }
      : {})
  };
};
