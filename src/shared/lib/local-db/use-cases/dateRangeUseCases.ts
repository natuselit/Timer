import type { LocalDateString } from '../../../../entities/shift';
import type { EnterpriseScheduleRepository } from '../repositories/enterpriseScheduleRepository';
import type { ShiftRepository } from '../repositories/shiftRepository';

export type LocalDataDateBounds = {
  start: LocalDateString;
  end: LocalDateString;
};

export const getLocalDataDateBounds = async (
  shiftRepository: ShiftRepository,
  enterpriseScheduleRepository: EnterpriseScheduleRepository
): Promise<LocalDataDateBounds | null> => {
  const [shiftBounds, scheduleBounds] = await Promise.all([
    shiftRepository.getDateBounds(),
    enterpriseScheduleRepository.getDateBounds()
  ]);
  const bounds = [shiftBounds, scheduleBounds].filter(
    (value): value is LocalDataDateBounds => value !== null
  );

  if (bounds.length === 0) {
    return null;
  }

  return {
    start: bounds.reduce(
      (earliest, value) => value.start < earliest ? value.start : earliest,
      bounds[0].start
    ),
    end: bounds.reduce(
      (latest, value) => value.end > latest ? value.end : latest,
      bounds[0].end
    )
  };
};
