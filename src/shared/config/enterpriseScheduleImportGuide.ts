export type EnterpriseScheduleImportStep = {
  title: string;
  description: string;
};

export const ENTERPRISE_SCHEDULE_IMPORT_STEPS = [
  {
    title: 'Відкрийте лист',
    description: 'Знайдіть на пошті лист «Ваш табель робочого часу».'
  },
  {
    title: 'Перейдіть до друку',
    description: 'Натисніть ⋮ у правому верхньому куті листа й оберіть «Друк».'
  },
  {
    title: 'Збережіть PDF',
    description: 'У вікні друку оберіть «Зберегти як PDF» та збережіть файл на пристрої.'
  },
  {
    title: 'Відкрийте «Таймер»',
    description: 'Перейдіть у «Графік», натисніть «Обрати PDF» та виберіть збережений файл.'
  },
  {
    title: 'Перевірте імпорт',
    description: 'Перегляньте кількість розпізнаних записів і підтвердьте імпорт.'
  },
  {
    title: 'Опрацюйте розбіжності',
    description:
      'Синхронізуйте зміну або пропустіть розбіжність. Якщо різниця суттєва — зверніться до керівництва.'
  }
] as const satisfies readonly EnterpriseScheduleImportStep[];

export const ENTERPRISE_SCHEDULE_IMPORT_NOTE =
  'Ваш PDF залишається на пристрої й нікуди не надсилається. Для імпорту потрібен текстовий шар — скановані PDF без тексту не підтримуються.';
