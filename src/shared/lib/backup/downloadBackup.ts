import type { ShifterDatabase } from '../local-db/database';
import { createBackup, serializeBackup, type ShifterBackup } from '../local-db/use-cases/backupUseCases';

const UKRAINIAN_TRANSLITERATION: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'h',
  ґ: 'g',
  д: 'd',
  е: 'e',
  є: 'ie',
  ж: 'zh',
  з: 'z',
  и: 'y',
  і: 'i',
  ї: 'i',
  й: 'i',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ь: '',
  ю: 'iu',
  я: 'ia'
};

const WORD_INITIAL_TRANSLITERATION: Record<string, string> = {
  є: 'ye',
  ї: 'yi',
  й: 'y',
  ю: 'yu',
  я: 'ya'
};

const isNameSeparator = (character: string): boolean => /[\s'’ʼ`-]/u.test(character);

const capitalize = (value: string): string =>
  value.length > 0 ? `${value[0].toUpperCase()}${value.slice(1)}` : value;

const transliterateNameComponent = (value: string): string => {
  const normalizedValue = value.trim().normalize('NFC');
  const hasLetters = /[A-Za-zА-Яа-яІіЇїЄєҐґ]/u.test(normalizedValue);
  const isAllUppercase =
    hasLetters &&
    normalizedValue === normalizedValue.toLocaleUpperCase('uk-UA');
  let result = '';
  let isWordInitial = true;

  for (let index = 0; index < normalizedValue.length; index += 1) {
    const character = normalizedValue[index];

    if (isNameSeparator(character)) {
      result += '-';
      isWordInitial = true;
      continue;
    }

    if (/[A-Za-z0-9]/.test(character)) {
      result += character;
      isWordInitial = false;
      continue;
    }

    const lowerCharacter = character.toLocaleLowerCase('uk-UA');
    let transliterated = isWordInitial
      ? (WORD_INITIAL_TRANSLITERATION[lowerCharacter] ??
        UKRAINIAN_TRANSLITERATION[lowerCharacter])
      : UKRAINIAN_TRANSLITERATION[lowerCharacter];

    if (transliterated === undefined) {
      continue;
    }

    const isUppercase = character === character.toLocaleUpperCase('uk-UA');

    if (isUppercase) {
      transliterated = isAllUppercase ? transliterated.toUpperCase() : capitalize(transliterated);
    }

    result += transliterated;
    isWordInitial = false;
  }

  return result.replace(/-+/g, '-').replace(/^-|-$/g, '') || 'Unknown';
};

export const buildBackupFileName = (
  employeeLastName: string,
  employeeFirstName: string,
  exportedAt: string
): string => {
  const lastName = transliterateNameComponent(employeeLastName);
  const firstName = transliterateNameComponent(employeeFirstName);
  const datePart = exportedAt.slice(0, 10);
  const timePart = exportedAt.slice(11, 16).replace(':', '-');

  return `${lastName}_${firstName}_${datePart}_${timePart}.json`;
};

export const downloadBackup = async (
  db: ShifterDatabase,
  exportedAt: string
): Promise<ShifterBackup> => {
  const backup = await createBackup(db, exportedAt);
  const blob = new Blob([serializeBackup(backup)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = buildBackupFileName(
    backup.settings.employeeLastName,
    backup.settings.employeeFirstName,
    backup.exportedAt
  );
  anchor.hidden = true;
  document.body.append(anchor);

  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return backup;
};
