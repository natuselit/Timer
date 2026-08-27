import type { Settings } from '../../../entities/settings';
import type { Shift } from '../../../entities/shift';
import { getTimeInputValue } from '../date-time';

const formatCompactTime = (dateTime: string): string =>
  getTimeInputValue(dateTime).replace(/^0/, '');

export const formatShiftClipboardText = (
  settings: Pick<Settings, 'employeeFirstName' | 'employeeLastName'>,
  shift: Shift & { endTime: string }
): string => {
  const lastName = settings.employeeLastName.trim();
  const firstName = settings.employeeFirstName.trim();
  const initial = Array.from(firstName)[0]?.toLocaleUpperCase('uk-UA') ?? '';
  const employeeName = [lastName, initial].filter(Boolean).join(' ');
  const workTime = `${formatCompactTime(shift.startTime)}-${formatCompactTime(shift.endTime)}`;

  return [employeeName, workTime].filter(Boolean).join(' ');
};

const copyWithLegacyApi = (text: string): boolean => {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') {
    return false;
  }

  const input = document.createElement('textarea');
  input.value = text;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.inset = '0 auto auto -9999px';
  input.style.fontSize = '16px';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.focus({ preventScroll: true });
  input.select();
  input.setSelectionRange(0, input.value.length);

  try {
    return document.execCommand('copy');
  } finally {
    input.remove();
  }
};

type ClipboardDependencies = {
  writeText?: (text: string) => Promise<void>;
  legacyCopy?: (text: string) => boolean;
};

type PreparedClipboardDependencies = {
  write?: (items: ClipboardItem[]) => Promise<void>;
  createClipboardItem?: (
    items: Record<string, string | Blob | PromiseLike<string | Blob>>
  ) => ClipboardItem;
};

export type PreparedTextClipboardWrite = {
  complete: (text: string) => Promise<boolean>;
  cancel: () => void;
};

export const prepareTextClipboardWrite = (
  dependencies: PreparedClipboardDependencies = {}
): PreparedTextClipboardWrite | null => {
  const write =
    dependencies.write ??
    (typeof navigator !== 'undefined' && navigator.clipboard?.write
      ? navigator.clipboard.write.bind(navigator.clipboard)
      : undefined);
  const createClipboardItem =
    dependencies.createClipboardItem ??
    (typeof ClipboardItem !== 'undefined'
      ? (items: Record<string, string | Blob | PromiseLike<string | Blob>>) =>
          new ClipboardItem(items)
      : undefined);

  if (!write || !createClipboardItem) {
    return null;
  }

  let resolveText!: (value: Blob) => void;
  let rejectText!: (reason: unknown) => void;
  let isSettled = false;
  const textPromise = new Promise<Blob>((resolve, reject) => {
    resolveText = resolve;
    rejectText = reject;
  });

  // Скасоване коротке утримання не повинно створювати unhandled rejection.
  void textPromise.catch(() => undefined);

  let writePromise: Promise<boolean>;

  try {
    const clipboardItem = createClipboardItem({ 'text/plain': textPromise });
    writePromise = Promise.resolve(write([clipboardItem])).then(
      () => true,
      () => false
    );
  } catch {
    return null;
  }

  return {
    complete: (text: string) => {
      if (!isSettled) {
        isSettled = true;
        resolveText(new Blob([text], { type: 'text/plain' }));
      }

      return writePromise;
    },
    cancel: () => {
      if (!isSettled) {
        isSettled = true;
        rejectText(new DOMException('Clipboard write cancelled.', 'AbortError'));
      }
    }
  };
};

export const copyTextToClipboard = async (
  text: string,
  dependencies: ClipboardDependencies = {}
): Promise<boolean> => {
  const writeText =
    dependencies.writeText ??
    (typeof navigator !== 'undefined' && navigator.clipboard
      ? navigator.clipboard.writeText.bind(navigator.clipboard)
      : undefined);

  if (writeText) {
    try {
      await writeText(text);
      return true;
    } catch {
      // Older mobile browsers may reject Clipboard API after a hold gesture.
    }
  }

  try {
    return (dependencies.legacyCopy ?? copyWithLegacyApi)(text);
  } catch {
    return false;
  }
};
