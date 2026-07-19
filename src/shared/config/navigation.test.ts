import { describe, expect, it } from 'vitest';
import { navigationItems } from './navigation';

describe('navigationItems', () => {
  it('contains the mobile shell placeholders', () => {
    expect(navigationItems.map((item) => item.id)).toEqual([
      'timer',
      'history',
      'analytics',
      'schedule',
      'settings'
    ]);
  });
});
