import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { PwaInstallProvider } from './shared/lib/pwa-install';
import { PullToRefresh } from './shared/ui/pull-to-refresh';
import './app/styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PwaInstallProvider>
      <PullToRefresh>
        <App />
      </PullToRefresh>
    </PwaInstallProvider>
  </StrictMode>
);
