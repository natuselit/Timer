import { Component, type ErrorInfo, type ReactNode } from 'react';
import { recordDiagnosticError } from './diagnostics';
import { downloadDiagnosticReport } from './report';

type DiagnosticErrorBoundaryProps = {
  children: ReactNode;
};

type DiagnosticErrorBoundaryState = {
  hasError: boolean;
  reportError: boolean;
};

export class DiagnosticErrorBoundary extends Component<
  DiagnosticErrorBoundaryProps,
  DiagnosticErrorBoundaryState
> {
  state: DiagnosticErrorBoundaryState = {
    hasError: false,
    reportError: false
  };

  static getDerivedStateFromError(): DiagnosticErrorBoundaryState {
    return { hasError: true, reportError: false };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    recordDiagnosticError(
      'app.react_render_failed',
      'app',
      error,
      errorInfo.componentStack ?? undefined
    );
    document.documentElement.removeAttribute('data-app-loading');
  }

  private downloadReport = async (): Promise<void> => {
    this.setState({ reportError: false });

    try {
      await downloadDiagnosticReport();
    } catch {
      this.setState({ reportError: true });
    }
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <main className="app-status" role="alert">
        <div className="app-status__content">
          <h1>Сталася помилка</h1>
          <p>Збережіть технічний звіт і перезапустіть застосунок.</p>
          <div className="app-status__actions">
            <button type="button" onClick={() => void this.downloadReport()}>
              Зберегти звіт
            </button>
            <button type="button" onClick={() => window.location.reload()}>
              Перезапустити
            </button>
          </div>
          {this.state.reportError ? <p>Не вдалося створити звіт.</p> : null}
        </div>
      </main>
    );
  }
}
