import './styles/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { readBoot } from './app/boot';
import { captureInstallPrompt } from './pwa/install';

captureInstallPrompt();

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing');

createRoot(container).render(
  <StrictMode>
    <App boot={readBoot()} />
  </StrictMode>,
);
