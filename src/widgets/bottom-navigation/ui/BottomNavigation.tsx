import { memo } from 'react';
import { BarChart3, CalendarCheck2, CalendarDays, Settings, Timer } from 'lucide-react';
import { navigationItems, type NavigationItem } from '../../../shared/config/navigation';
import './BottomNavigation.css';

const navigationIcons = {
  timer: Timer,
  history: CalendarDays,
  analytics: BarChart3,
  schedule: CalendarCheck2,
  settings: Settings
};

type BottomNavigationProps = {
  activeItem: NavigationItem['id'];
  onSelect: (item: NavigationItem['id']) => void;
};

export const BottomNavigation = memo(function BottomNavigation({
  activeItem,
  onSelect
}: BottomNavigationProps) {
  return (
    <nav className="bottom-navigation" aria-label="Основна навігація">
      {navigationItems.map((item) => {
        const Icon = navigationIcons[item.id];

        return (
          <button
            className="bottom-navigation__item"
            aria-current={activeItem === item.id ? 'page' : undefined}
            data-active={activeItem === item.id ? 'true' : 'false'}
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
          >
            <Icon aria-hidden="true" size={22} strokeWidth={2} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
});
