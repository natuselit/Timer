import type { DiagnosticLogRecord } from '../../diagnostics/types';
import type { ShifterDatabase } from '../database';

export class DiagnosticLogRepository {
  constructor(private readonly db: ShifterDatabase) {}

  async add(record: DiagnosticLogRecord): Promise<void> {
    await this.db.diagnosticLogs.put(record);
  }

  async getAll(): Promise<DiagnosticLogRecord[]> {
    return this.db.diagnosticLogs.orderBy('timestamp').toArray();
  }

  async count(): Promise<number> {
    return this.db.diagnosticLogs.count();
  }

  async clear(): Promise<void> {
    await this.db.diagnosticLogs.clear();
  }
}
