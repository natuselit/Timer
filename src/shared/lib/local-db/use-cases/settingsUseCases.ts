import type { Settings } from '../../../../entities/settings';
import type { SettingsRepository } from '../repositories/settingsRepository';

export const getSettings = (repository: SettingsRepository): Promise<Settings> =>
  repository.getSettings();

export const saveSettings = (
  repository: SettingsRepository,
  settings: Settings
): Promise<Settings> => repository.saveSettings(settings);

