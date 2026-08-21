import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { PwaInstallProvider } from './shared/lib/pwa-install';
import './app/styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PwaInstallProvider>
      <App />
    </PwaInstallProvider>
  </StrictMode>
);
