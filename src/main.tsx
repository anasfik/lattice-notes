import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Lattice Notes could not find its mount point (#root).');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// The offline shell is an enhancement: the app works without it, so a failed
// registration is logged and never blocks the first paint.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const base = import.meta.env.BASE_URL.endsWith('/')
      ? import.meta.env.BASE_URL
      : `${import.meta.env.BASE_URL}/`;

    navigator.serviceWorker
      .register(`${base}sw.js`, { scope: base })
      .catch((error: unknown) => {
        console.warn('Lattice Notes: the offline shell is unavailable; the app still works.', error);
      });
  });
}
