// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  EnterpriseSchedulePdfError,
  extractEnterpriseScheduleSource,
  parseEnterpriseSchedulePdf,
  readPdfFileBytes,
  reconstructPdfTextLines
} from './pdfParser';
import { parseEnterpriseScheduleText } from './parser';

describe('enterprise schedule PDF parsing', () => {
  it('reconstructs table rows by vertical position and horizontal order', () => {
    const lines = reconstructPdfTextLines([
      { str: '06:01', transform: [1, 0, 0, 1, 420, 700] },
      { str: '01.07.2026', transform: [1, 0, 0, 1, 70, 700] },
      { str: 'In time', transform: [1, 0, 0, 1, 240, 700] },
      { str: 'Out time', transform: [1, 0, 0, 1, 240, 680] },
      { str: '01.07.2026', transform: [1, 0, 0, 1, 70, 680] },
      { str: '14 : 30', transform: [1, 0, 0, 1, 420, 680] }
    ]);

    expect(lines).toEqual([
      '01.07.2026 In time 06:01',
      '01.07.2026 Out time 14:30'
    ]);
  });

  it('extracts the old block layout and ignores Gmail and summary text', () => {
    const source = extractEnterpriseScheduleSource([
      'Ваш табель робочого часу',
      'Інформація для: Працівник',
      '--30.05.2026--',
      'In time: 06:00',
      'Out time: 15:29',
      'Total: 09:29',
      'Колонка 4:',
      '--31.05.2026--',
      'In time:',
      'Out time:',
      'Total: :',
      'Итого (отработано): 09:29',
      '--00:00:00--',
      '#VALUE! 528:00:00'
    ]);
    const result = parseEnterpriseScheduleText(source);

    expect(source).not.toContain('Працівник');
    expect(source).not.toContain('Итого');
    expect(result.errors).toEqual([]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      date: '2026-05-30',
      inTime: '06:00',
      outTime: '15:29'
    });
    expect(result.skippedEmptyCount).toBe(1);
  });

  it('extracts the table layout across page boundaries and ignores total rows', () => {
    const source = extractEnterpriseScheduleSource([
      'Дата Показник Значення',
      '01.07.2026 In time 06:01',
      '01.07.2026 Out time 14:30',
      '01.07.2026 Total 08:29',
      '02.07.2026 In time -',
      '02.07.2026 Out time -',
      '02.07.2026 Total :',
      'Дата Показник Значення',
      '03.07.2026 In time 14:30',
      '03.07.2026 Out time 22:32',
      '03.07.2026 Total 08:02',
      '31.07.2026 Итого (отработано) 216:38',
      'Коеф. 2,00 Норма (план), годин 184:00'
    ]);
    const result = parseEnterpriseScheduleText(source);

    expect(result.errors).toEqual([]);
    expect(result.items.map((item) => item.date)).toEqual(['2026-07-01', '2026-07-03']);
    expect(result.skippedEmptyCount).toBe(1);
  });

  it('keeps genuine schedule validation errors after removing document noise', () => {
    const source = extractEnterpriseScheduleSource([
      'Ваш табель робочого часу',
      '01.07.2026 In time 06:01',
      '01.07.2026 Out time 14:30',
      '01.07.2026 Total 08:28'
    ]);
    const result = parseEnterpriseScheduleText(source);

    expect(result.items).toEqual([]);
    expect(result.errors[0]?.message).toContain('Total не збігається');
  });

  it('rejects a non-PDF file before loading PDF.js', async () => {
    const file = new File(['schedule'], 'schedule.txt', { type: 'text/plain' });

    await expect(parseEnterpriseSchedulePdf(file)).rejects.toEqual(
      expect.objectContaining<Partial<EnterpriseSchedulePdfError>>({
        code: 'invalid-file-type',
        message: 'Оберіть файл у форматі PDF.',
        stage: 'file-validation'
      })
    );
  });

  it('falls back to FileReader when Blob.arrayBuffer is unavailable on iOS', async () => {
    const file = new File(['%PDF'], 'schedule.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'arrayBuffer', { value: undefined });

    await expect(readPdfFileBytes(file)).resolves.toEqual(
      new Uint8Array([37, 80, 68, 70])
    );
  });

  it('marks a PDF engine rejection as a document-open failure', async () => {
    const file = new File(['%PDF-not-valid'], 'schedule.pdf', {
      type: 'application/pdf'
    });

    await expect(parseEnterpriseSchedulePdf(file)).rejects.toEqual(
      expect.objectContaining<Partial<EnterpriseSchedulePdfError>>({
        code: 'invalid-pdf',
        stage: 'document-open',
        cause: expect.any(Error)
      })
    );
  });
});
