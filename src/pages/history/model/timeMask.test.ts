import { describe, expect, it } from 'vitest';
import { formatTimeInputDraft, normalizeTimeInput } from './timeMask';

describe('normalizeTimeInput', () => {
  it('доповнює короткий ввід до повного часу', () => {
    expect(normalizeTimeInput('7')).toBe('07:00');
    expect(normalizeTimeInput('14')).toBe('14:00');
  });

  it('розпізнає три цифри як зручний ручний ввід', () => {
    expect(normalizeTimeInput('630')).toBe('06:30');
    expect(normalizeTimeInput('143')).toBe('14:30');
  });

  it('форматує чотири цифри як HH:mm', () => {
    expect(normalizeTimeInput('0630')).toBe('06:30');
    expect(normalizeTimeInput('1430')).toBe('14:30');
  });

  it('приймає вставку з двокрапкою', () => {
    expect(normalizeTimeInput('7:3')).toBe('07:30');
    expect(normalizeTimeInput('14:30')).toBe('14:30');
  });

  it('автоматично виправляє неможливі межі часу', () => {
    expect(normalizeTimeInput('2999')).toBe('23:59');
    expect(normalizeTimeInput('24:90')).toBe('23:59');
  });

  it('ігнорує зайві символи', () => {
    expect(normalizeTimeInput('a1b4:3x0')).toBe('14:30');
  });
});

describe('formatTimeInputDraft', () => {
  it('показує проміжну маску без системного time picker', () => {
    expect(formatTimeInputDraft('143')).toBe('14:3');
    expect(formatTimeInputDraft('630')).toBe('6:30');
    expect(formatTimeInputDraft('1430')).toBe('14:30');
  });

  it('чистить вставлений текст під час вводу', () => {
    expect(formatTimeInputDraft('a1b4:3x0')).toBe('14:30');
    expect(formatTimeInputDraft('12:345')).toBe('12:34');
  });
});
