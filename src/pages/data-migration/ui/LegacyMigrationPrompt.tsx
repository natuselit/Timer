import { useEffect, useRef, useState } from 'react';
import { Download, ExternalLink, MoveRight, ShieldCheck } from 'lucide-react';
import { SITES_APP_URL } from '../../../shared/config/sitesMigration';
import { downloadBackup } from '../../../shared/lib/backup';
import { localDb } from '../../../shared/lib/local-db';
import { toLocalIsoString } from '../../../shared/lib/date-time';
import {
  recordDiagnosticBreadcrumb,
  recordDiagnosticError
} from '../../../shared/lib/diagnostics';
import './LegacyMigrationPrompt.css';

type LegacyMigrationPromptProps = {
  onDismiss: () => void;
};

export function LegacyMigrationPrompt({ onDismiss }: LegacyMigrationPromptProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [backupCreated, setBackupCreated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const exportButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    exportButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onDismiss();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onDismiss]);

  const exportBackup = async () => {
    setIsExporting(true);
    setError(null);
    recordDiagnosticBreadcrumb('backup.export_started', 'migration');

    try {
      await downloadBackup(localDb, toLocalIsoString(new Date()));
      recordDiagnosticBreadcrumb('backup.export_completed', 'migration');
      setBackupCreated(true);
    } catch (exportError) {
      recordDiagnosticError('backup.export_failed', 'migration', exportError);
      setError('Не вдалося створити JSON backup. Спробуйте ще раз.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="legacy-migration-prompt" role="presentation">
      <section
        className="legacy-migration-prompt__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="legacy-migration-title"
        aria-describedby="legacy-migration-description"
      >
        <div className="legacy-migration-prompt__icon" aria-hidden="true">
          <MoveRight size={28} />
        </div>

        <header className="legacy-migration-prompt__heading">
          <p>Перехід на ChatGPT Sites</p>
          <h2 id="legacy-migration-title">Доступна нова версія</h2>
          <p id="legacy-migration-description">
            Дані зберігаються окремо для кожної адреси. Перенесіть їх через один
            актуальний JSON-backup.
          </p>
        </header>

        <ol className="legacy-migration-prompt__steps">
          <li>
            <span>1</span>
            <p>Створіть і збережіть backup зі старої версії.</p>
          </li>
          <li>
            <span>2</span>
            <p>Відкрийте нову версію застосунку.</p>
          </li>
          <li>
            <span>3</span>
            <p>Виберіть JSON-файл і підтвердьте імпорт.</p>
          </li>
        </ol>

        <div className="legacy-migration-prompt__safe-note">
          <ShieldCheck size={20} aria-hidden="true" />
          <p>Старі дані та завантажений файл не видаляються.</p>
        </div>

        {backupCreated ? (
          <p className="legacy-migration-prompt__success" role="status">
            Backup створено. Тепер відкрийте нову версію та виберіть цей JSON-файл.
          </p>
        ) : null}

        {error ? (
          <p className="legacy-migration-prompt__error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="legacy-migration-prompt__actions">
          <button
            ref={exportButtonRef}
            className="legacy-migration-prompt__primary"
            type="button"
            disabled={isExporting}
            onClick={() => void exportBackup()}
          >
            <Download size={19} aria-hidden="true" />
            {isExporting
              ? 'Створення...'
              : backupCreated
                ? 'Створити backup ще раз'
                : 'Створити backup'}
          </button>

          <a
            className="legacy-migration-prompt__secondary"
            href={SITES_APP_URL}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={19} aria-hidden="true" />
            Відкрити нову версію
          </a>

          <button
            className="legacy-migration-prompt__dismiss"
            type="button"
            onClick={onDismiss}
          >
            Залишитися тут
          </button>
        </div>
      </section>
    </div>
  );
}
