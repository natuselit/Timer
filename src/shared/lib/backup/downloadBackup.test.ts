import { describe, expect, it } from 'vitest';
import { buildBackupFileName } from './downloadBackup';

describe('buildBackupFileName', () => {
  it('transliterates a Ukrainian surname and first name', () => {
    expect(
      buildBackupFileName(
        'Кухарчук',
        'Артем',
        '2026-08-25T14:30:45.000+03:00'
      )
    ).toBe('Kukharchuk_Artem_2026-08-25_14-30.json');
  });

  it('preserves an existing Latin name and its casing', () => {
    expect(
      buildBackupFileName(
        'McArthur',
        'Ivan',
        '2026-08-25T08:05:00.000+03:00'
      )
    ).toBe('McArthur_Ivan_2026-08-25_08-05.json');
  });

  it('uses hyphens for spaces and apostrophes and removes unsafe characters', () => {
    expect(
      buildBackupFileName(
        ' ОʼКоннор -- Сміт! ',
        ' Анна  Марія? ',
        '2026-08-25T09:10:00.000+03:00'
      )
    ).toBe('O-Konnor-Smit_Anna-Mariia_2026-08-25_09-10.json');
  });

  it('uses an English fallback for missing or unsupported name components', () => {
    expect(
      buildBackupFileName('', '李', '2026-08-25T11:20:00.000+03:00')
    ).toBe('Unknown_Unknown_2026-08-25_11-20.json');
  });

  it('keeps the local date and time encoded in exportedAt', () => {
    const fileName = buildBackupFileName(
      'Іваненко',
      'Іван',
      '2026-08-25T23:55:00.000-07:00'
    );

    expect(fileName).toBe('Ivanenko_Ivan_2026-08-25_23-55.json');
    expect(fileName).toMatch(/^[A-Za-z0-9_-]+\.json$/);
  });
});
