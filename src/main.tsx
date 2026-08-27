import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { PwaInstallProvider } from './shared/lib/pwa-install';
import { PullToRefresh } from './shared/ui/pull-to-refresh';
import {
  DiagnosticErrorBoundary,
  installGlobalDiagnostics
} from './shared/lib/diagnostics';
import './app/styles/global.css';

installGlobalDiagnostics();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DiagnosticErrorBoundary>
      <PwaInstallProvider>
        <PullToRefresh>
          <App />
        </PullToRefresh>
      </PwaInstallProvider>
    </DiagnosticErrorBoundary>
  </StrictMode>
);
