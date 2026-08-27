import { useRef, useState, type ChangeEvent } from 'react';
import { Check, Database, ExternalLink, FileUp, ShieldCheck } from 'lucide-react';
import type { Settings } from '../../../entities/settings';
import { LEGACY_GITHUB_PAGES_URL } from '../../../shared/config/sitesMigration';
import {
  BackupValidationError,
  localDb,
  parseBackupImportJson,
  replaceShiftsFromLegacyBackup,
  restoreBackup
} from '../../../shared/lib/local-db';
import {
  recordDiagnosticBreadcrumb,
  recordDiagnosticError
} from '../../../shared/lib/diagnostics';
import './DataMigrationPage.css';

type DataMigrationPageProps = {
  currentSettings: Settings;
  onComplete: (settings: Settings) => Promise<void>;
  onSkip: () => Promise<void>;
};

type MigrationResult = {
  kind: 'shifter' | 'legacy';
  settings: Settings;
  shiftCount: number;
  scheduleCount: number;
};

const getImportErrorMessage = (error: unknown): string => {
  if (error instanceof BackupValidationError) {
    return error.message;
  }

  return 'Не вдалося відновити backup. Поточні дані Sites не змінено.';
};

export function DataMigrationPage({
  currentSettings,
  onComplete,
  onSkip
}: DataMigrationPageProps) {
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MigrationResult | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const importBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    setIsBusy(true);
    setError(null);
    recordDiagnosticBreadcrumb('migration.import_started', 'migration');

    try {
      const source = await file.text();
      const parsedImport = parseBackupImportJson(source);

      if (parsedImport.kind === 'legacy') {
        if (
          !window.confirm(
            `Файл містить ${parsedImport.shifts.length} змін зі старого додатку. Історію на Sites буде замінено, а налаштування потрібно буде заповнити окремо. Продовжити?`
          )
        ) {
          return;
        }

        await replaceShiftsFromLegacyBackup(localDb, parsedImport.shifts);
        setResult({
          kind: 'legacy',
          settings: currentSettings,
          shiftCount: parsedImport.shifts.length,
          scheduleCount: 0
        });
      } else {
        const { backup } = parsedImport;

        if (
          !window.confirm(
            `Backup містить ${backup.shifts.length} змін і ${backup.enterpriseSchedule.length} записів графіка. Поточні локальні дані Sites буде замінено. Дані на GitHub Pages і сам JSON-файл залишаться без змін. Продовжити?`
          )
        ) {
          return;
        }

        const restoredSettings = await restoreBackup(localDb, backup);
        setResult({
          kind: 'shifter',
          settings: restoredSettings,
          shiftCount: backup.shifts.length,
          scheduleCount: backup.enterpriseSchedule.length
        });
      }
      recordDiagnosticBreadcrumb('migration.import_completed', 'migration');
    } catch (importError) {
      recordDiagnosticError('migration.import_failed', 'migration', importError);
      setError(getImportErrorMessage(importError));
    } finally {
      setIsBusy(false);
    }
  };

  const skipMigration = async () => {
    if (
      !window.confirm(
        'Почати без перенесення? Дані на GitHub Pages не видаляться, а імпорт залишиться доступним у Налаштуваннях.'
      )
    ) {
      return;
    }

    setIsBusy(true);
    setError(null);

    try {
      await onSkip();
    } catch (skipError) {
      recordDiagnosticError('migration.status_write_failed', 'migration', skipError);
      setError('Не вдалося зберегти вибір. Спробуйте ще раз.');
      setIsBusy(false);
    }
  };

  const finishMigration = async () => {
    if (!result) {
      return;
    }

    setIsBusy(true);
    setError(null);

    try {
      await onComplete(result.settings);
    } catch (finishError) {
      recordDiagnosticError('migration.status_write_failed', 'migration', finishError);
      setError('Дані відновлено, але не вдалося завершити перехід. Спробуйте ще раз.');
      setIsBusy(false);
    }
  };

  if (result) {
    return (
      <main className="data-migration" aria-labelledby="data-migration-title">
        <section className="data-migration__panel data-migration__panel--success">
          <span className="data-migration__icon data-migration__icon--success" aria-hidden="true">
            <Check size={30} />
          </span>
          <div className="data-migration__heading">
            <p>Перенесення завершено</p>
            <h1 id="data-migration-title">Дані відновлено</h1>
            <p>
              {result.kind === 'shifter'
                ? `Відновлено змін: ${result.shiftCount}, записів графіка: ${result.scheduleCount}. Налаштування також перенесено.`
                : `Відновлено змін: ${result.shiftCount}. Завершіть початкове налаштування для Sites.`}
            </p>
          </div>
          <div className="data-migration__safe-note">
            <ShieldCheck size={20} aria-hidden="true" />
            <p>
              Старі дані не видалено. Збережіть JSON, доки не перевірите історію,
              аналітику та графік у Sites.
            </p>
          </div>
          {error ? <p className="data-migration__error" role="alert">{error}</p> : null}
          <button
            className="data-migration__primary"
            type="button"
            disabled={isBusy}
            onClick={() => void finishMigration()}
          >
            Відкрити застосунок
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="data-migration" aria-labelledby="data-migration-title">
      <section className="data-migration__panel">
        <span className="data-migration__icon" aria-hidden="true">
          <Database size={30} />
        </span>
        <div className="data-migration__heading">
          <p>Перехід на ChatGPT Sites</p>
          <h1 id="data-migration-title">Перенесіть дані без втрат</h1>
          <p>
            Браузер зберігає дані окремо для кожної адреси, тому потрібен один JSON-backup.
            Передача відбувається локально на вашому пристрої.
          </p>
        </div>

        <ol className="data-migration__steps">
          <li>
            <span>1</span>
            <p>Відкрийте стару версію на GitHub Pages.</p>
          </li>
          <li>
            <span>2</span>
            <p>У «Налаштуваннях» відкрийте «Дані та backup» і натисніть «Експорт».</p>
          </li>
          <li>
            <span>3</span>
            <p>Поверніться сюди та виберіть збережений JSON-файл.</p>
          </li>
        </ol>

        <a
          className="data-migration__legacy-link"
          href={LEGACY_GITHUB_PAGES_URL}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={18} aria-hidden="true" />
          Відкрити стару версію
        </a>

        <button
          className="data-migration__primary"
          type="button"
          disabled={isBusy}
          onClick={() => inputRef.current?.click()}
        >
          <FileUp size={19} aria-hidden="true" />
          Вибрати backup JSON
        </button>
        <input
          ref={inputRef}
          className="data-migration__file-input"
          type="file"
          accept="application/json,.json"
          onChange={(event) => void importBackup(event)}
        />

        {error ? <p className="data-migration__error" role="alert">{error}</p> : null}

        <button
          className="data-migration__skip"
          type="button"
          disabled={isBusy}
          onClick={() => void skipMigration()}
        >
          Почати без перенесення
        </button>
        <p className="data-migration__footnote">
          Цей вибір нічого не видаляє зі старої адреси. Імпорт можна виконати пізніше в
          налаштуваннях.
        </p>
      </section>
    </main>
  );
}
