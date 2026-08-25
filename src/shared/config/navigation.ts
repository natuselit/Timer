export type NavigationItem = {
  id: 'timer' | 'history' | 'analytics' | 'schedule' | 'settings';
  label: string;
  active?: boolean;
};

export const ACTIVE_NAVIGATION_SESSION_KEY = 'active-navigation-item';

export const navigationItems: NavigationItem[] = [
  { id: 'timer', label: 'Таймер', active: true },
  { id: 'history', label: 'Історія' },
  { id: 'analytics', label: 'Аналітика' },
  { id: 'schedule', label: 'Графік' },
  { id: 'settings', label: 'Налашт.' }
];

export const getStoredNavigationItem = (
  storage: Pick<Storage, 'getItem'> | null | undefined
): NavigationItem['id'] => {
  try {
    const storedItem = storage?.getItem(ACTIVE_NAVIGATION_SESSION_KEY);

    return navigationItems.some(({ id }) => id === storedItem)
      ? (storedItem as NavigationItem['id'])
      : 'timer';
  } catch {
    return 'timer';
  }
};
