import {
  parseEnterpriseScheduleText,
  type EnterpriseScheduleParseResult
} from './parser';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import 'pdfjs-dist/legacy/build/pdf.worker.min.mjs';
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy
} from 'pdfjs-dist';
import type { TextContent } from 'pdfjs-dist/types/src/display/api';

const PDF_MIME_TYPE = 'application/pdf';
const LINE_Y_TOLERANCE = 2;
const BLOCK_DATE_PATTERN = /^--\s*(\d{2}\.\d{2}\.\d{4})\s*--$/;
const BLOCK_FIELD_PATTERN = /^(In time|Out time|Total)\s*:\s*(\d{2}:\d{2}|-|:)?$/;
const INLINE_FIELD_PATTERN = /^(\d{2}\.\d{2}\.\d{4})\s+(In time|Out time|Total)\s*:?[ \t]*(\d{2}:\d{2}|-|:)?$/;

export type EnterpriseSchedulePdfErrorCode =
  | 'invalid-file-type'
  | 'password-protected'
  | 'invalid-pdf'
  | 'missing-text-layer'
  | 'schedule-not-found';

export type EnterpriseSchedulePdfStage =
  | 'file-validation'
  | 'file-read'
  | 'document-open'
  | 'text-extraction'
  | 'schedule-recognition';

type EnterpriseSchedulePdfErrorOptions = ErrorOptions & {
  stage: EnterpriseSchedulePdfStage;
};

export class EnterpriseSchedulePdfError extends Error {
  readonly code: EnterpriseSchedulePdfErrorCode;
  readonly stage: EnterpriseSchedulePdfStage;

  constructor(
    code: EnterpriseSchedulePdfErrorCode,
    message: string,
    options: EnterpriseSchedulePdfErrorOptions
  ) {
    super(message, options);
    this.name = 'EnterpriseSchedulePdfError';
    this.code = code;
    this.stage = options.stage;
  }
}

export type EnterpriseSchedulePdfParseResult = EnterpriseScheduleParseResult & {
  fileName: string;
  pageCount: number;
};

export type PdfTextItemLike = {
  str: string;
  transform: ArrayLike<number>;
};

type PositionedTextItem = {
  str: string;
  x: number;
  y: number;
};

const normalizePdfLine = (value: string): string =>
  value
    .replace(/\s+/g, ' ')
    .replace(/(\d)\s*\.\s*(?=\d)/g, '$1.')
    .replace(/(\d)\s*:\s*(?=\d)/g, '$1:')
    .replace(/\s+:/g, ':')
    .trim();

export const reconstructPdfTextLines = (items: PdfTextItemLike[]): string[] => {
  const positionedItems: PositionedTextItem[] = items
    .map((item) => ({
      str: item.str.trim(),
      x: Number(item.transform[4] ?? 0),
      y: Number(item.transform[5] ?? 0)
    }))
    .filter((item) => item.str.length > 0)
    .sort((left, right) => right.y - left.y || left.x - right.x);

  const lines: Array<{ y: number; items: PositionedTextItem[] }> = [];

  positionedItems.forEach((item) => {
    const currentLine = lines.at(-1);

    if (!currentLine || Math.abs(currentLine.y - item.y) > LINE_Y_TOLERANCE) {
      lines.push({ y: item.y, items: [item] });
      return;
    }

    currentLine.items.push(item);
  });

  return lines
    .map((line) =>
      normalizePdfLine(
        line.items
          .sort((left, right) => left.x - right.x)
          .map((item) => item.str)
          .join(' ')
      )
    )
    .filter(Boolean);
};

export const extractEnterpriseScheduleSource = (lines: string[]): string => {
  const scheduleLines: string[] = [];
  let insideBlock = false;

  lines.forEach((rawLine) => {
    const line = normalizePdfLine(rawLine);
    const inlineMatch = line.match(INLINE_FIELD_PATTERN);

    if (inlineMatch) {
      const [, date, fieldName, rawValue] = inlineMatch;
      const value = rawValue || (fieldName === 'Total' ? ':' : '-');

      scheduleLines.push(`${date} ${fieldName} ${value}`);
      insideBlock = false;
      return;
    }

    const dateMatch = line.match(BLOCK_DATE_PATTERN);

    if (dateMatch) {
      scheduleLines.push(`--${dateMatch[1]}--`);
      insideBlock = true;
      return;
    }

    if (!insideBlock) {
      return;
    }

    const fieldMatch = line.match(BLOCK_FIELD_PATTERN);

    if (!fieldMatch) {
      return;
    }

    const [, fieldName, rawValue] = fieldMatch;
    const value = rawValue === '-' ? '' : rawValue ?? '';

    scheduleLines.push(`${fieldName}: ${value}`.trimEnd());
  });

  return scheduleLines.join('\n');
};

const isPdfFile = (file: File): boolean =>
  file.type === PDF_MIME_TYPE || /\.pdf$/i.test(file.name);

const readFileWithFileReader = (file: File): Promise<ArrayBuffer> =>
  new Promise((resolve, reject) => {
    if (typeof FileReader === 'undefined') {
      reject(new Error('FileReader is not available.'));
      return;
    }

    const reader = new FileReader();

    reader.addEventListener('load', () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
        return;
      }

      reject(new Error('PDF file could not be read as binary data.'));
    });
    reader.addEventListener('error', () => {
      reject(reader.error ?? new Error('PDF file reading failed.'));
    });
    reader.addEventListener('abort', () => {
      reject(new Error('PDF file reading was aborted.'));
    });
    reader.readAsArrayBuffer(file);
  });

export const readPdfFileBytes = async (file: File): Promise<Uint8Array> => {
  if (typeof file.arrayBuffer === 'function') {
    try {
      return new Uint8Array(await file.arrayBuffer());
    } catch {
      // FileReader remains the most compatible path for older iOS web views.
    }
  }

  return new Uint8Array(await readFileWithFileReader(file));
};

export const readPdfPageTextContent = async (
  page: Pick<PDFPageProxy, 'streamTextContent'>
): Promise<TextContent> => {
  const stream = page.streamTextContent() as ReadableStream<TextContent>;
  const reader = stream.getReader();
  const textContent: TextContent = {
    items: [],
    styles: Object.create(null) as TextContent['styles'],
    lang: null
  };

  try {
    while (true) {
      const { value, done } = await reader.read();

      if (done) {
        break;
      }

      textContent.lang ??= value.lang;
      Object.assign(textContent.styles, value.styles);
      textContent.items.push(...value.items);
    }
  } finally {
    reader.releaseLock();
  }

  return textContent;
};

const getPdfError = (
  error: unknown,
  stage: EnterpriseSchedulePdfStage
): EnterpriseSchedulePdfError => {
  const errorName = error instanceof Error ? error.name : '';

  if (errorName === 'PasswordException') {
    return new EnterpriseSchedulePdfError(
      'password-protected',
      'PDF захищений паролем. Оберіть незахищений файл табеля.',
      { stage }
    );
  }

  return new EnterpriseSchedulePdfError(
    'invalid-pdf',
    'Не вдалося прочитати PDF. Перевірте, чи файл не пошкоджений.',
    { cause: error, stage }
  );
};

export const parseEnterpriseSchedulePdf = async (
  file: File
): Promise<EnterpriseSchedulePdfParseResult> => {
  if (!isPdfFile(file)) {
    throw new EnterpriseSchedulePdfError(
      'invalid-file-type',
      'Оберіть файл у форматі PDF.',
      { stage: 'file-validation' }
    );
  }

  let loadingTask: PDFDocumentLoadingTask | null = null;
  let pdfDocument: PDFDocumentProxy | null = null;
  let stage: EnterpriseSchedulePdfStage = 'file-read';

  try {
    const data = await readPdfFileBytes(file);
    stage = 'document-open';
    loadingTask = getDocument({ data });
    pdfDocument = await loadingTask.promise;
    stage = 'text-extraction';
    const lines: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      const textContent = await readPdfPageTextContent(page);
      const pageItems = textContent.items
        .filter((item) => 'str' in item && 'transform' in item)
        .map((item) => ({ str: item.str, transform: item.transform }));

      lines.push(...reconstructPdfTextLines(pageItems));
      page.cleanup();
    }

    if (lines.length === 0) {
      throw new EnterpriseSchedulePdfError(
        'missing-text-layer',
        'PDF не містить текстового шару. Скановані файли без тексту не підтримуються.',
        { stage }
      );
    }

    stage = 'schedule-recognition';
    const scheduleSource = extractEnterpriseScheduleSource(lines);

    if (!scheduleSource) {
      throw new EnterpriseSchedulePdfError(
        'schedule-not-found',
        'У PDF не знайдено рядків табеля In time, Out time і Total.',
        { stage }
      );
    }

    return {
      ...parseEnterpriseScheduleText(scheduleSource),
      fileName: file.name,
      pageCount: pdfDocument.numPages
    };
  } catch (error) {
    if (error instanceof EnterpriseSchedulePdfError) {
      throw error;
    }

    throw getPdfError(error, stage);
  } finally {
    await pdfDocument?.cleanup();
    await loadingTask?.destroy();
  }
};
