import type { ShiftTemplateId, ShiftType } from '../../shift';

export type EnterpriseScheduleItem = {
  id: string;
  date: string;
  shiftType: ShiftType;
  templateId?: ShiftTemplateId;
  templateNameSnapshot?: string;
  plannedStartTime: string;
  plannedEndTime: string;
  enterpriseStartTime: string;
  enterpriseEndTime: string;
  skipped: boolean;
  sourceText: string;
  createdAt: string;
  updatedAt: string;
};
