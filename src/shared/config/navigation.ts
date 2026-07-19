export type NavigationItem = {
  id: 'timer' | 'history' | 'analytics' | 'schedule' | 'settings';
  label: string;
  active?: boolean;
};

export const navigationItems: NavigationItem[] = [
  { id: 'timer', label: 'Таймер', active: true },
  { id: 'history', label: 'Історія' },
  { id: 'analytics', label: 'Аналітика' },
  { id: 'schedule', label: 'Графік' },
  { id: 'settings', label: 'Налашт.' }
];
