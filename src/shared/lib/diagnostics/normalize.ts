import type { DiagnosticErrorDetails } from './types';

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

  return {
    name: error.name,
    message: error.message,
    ...(typeof error.stack === 'string' ? { stack: error.stack } : {}),
    ...(componentStack !== undefined ? { componentStack } : {})
  };
};
