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
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();

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

  return (dependencies.legacyCopy ?? copyWithLegacyApi)(text);
};
