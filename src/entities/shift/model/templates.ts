import { BUILT_IN_SHIFT_TEMPLATES } from './constants';
import { toMinutesFromMidnight } from './detection';
import type { ShiftTemplate } from './types';

export const SHIFT_TEMPLATE_NAME_MAX_LENGTH = 40;

export const getShiftTemplateDurationMinutes = (
  template: Pick<ShiftTemplate, 'startTime' | 'endTime'>
): number => {
  const start = toMinutesFromMidnight(template.startTime);
  const end = toMinutesFromMidnight(template.endTime);
  const duration = (end - start + 24 * 60) % (24 * 60);

  return duration === 0 ? 0 : duration;
};

export const validateShiftTemplates = (templates: readonly ShiftTemplate[]): void => {
  const ids = new Set<string>();
  const activeStartTimes = new Set<string>();

  templates.forEach((template) => {
    const name = template.name.trim();

    if (ids.has(template.id)) {
      throw new Error('Ідентифікатори шаблонів змін не можуть повторюватися.');
    }
    ids.add(template.id);

    if (name.length < 1 || name.length > SHIFT_TEMPLATE_NAME_MAX_LENGTH) {
      throw new Error('Назва шаблону має містити від 1 до 40 символів.');
    }

    const duration = getShiftTemplateDurationMinutes(template);

    if (duration < 1 || duration > 1439) {
      throw new Error('Тривалість зміни має бути від 1 до 1439 хвилин.');
    }

    if (template.enabled) {
      if (activeStartTimes.has(template.startTime)) {
        throw new Error('Активні шаблони не можуть мати однаковий час початку.');
      }
      activeStartTimes.add(template.startTime);
    }
  });
};

export const normalizeShiftTemplates = (value: unknown): ShiftTemplate[] => {
  const customTemplates = Array.isArray(value)
    ? value.filter((item): item is ShiftTemplate => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          return false;
        }

        const candidate = item as Partial<ShiftTemplate>;

        return (
          typeof candidate.id === 'string' &&
          !BUILT_IN_SHIFT_TEMPLATES.some((template) => template.id === candidate.id) &&
          typeof candidate.name === 'string' &&
          typeof candidate.startTime === 'string' &&
          typeof candidate.endTime === 'string' &&
          candidate.isBuiltIn === false &&
          typeof candidate.enabled === 'boolean' &&
          typeof candidate.createdAt === 'string' &&
          typeof candidate.updatedAt === 'string'
        );
      })
    : [];

  const templates = [
    ...BUILT_IN_SHIFT_TEMPLATES.map((template) => ({ ...template })),
    ...customTemplates
  ];

  try {
    validateShiftTemplates(templates);
    return templates;
  } catch {
    return BUILT_IN_SHIFT_TEMPLATES.map((template) => ({ ...template }));
  }
};

export const getShiftTemplate = (
  templates: readonly ShiftTemplate[],
  templateId: string
): ShiftTemplate | undefined => templates.find((template) => template.id === templateId);
