import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import './styles/index.css';
import { App } from './app/App';
import { ErrorBoundary } from './app/ErrorBoundary';
import { parseTagParam } from './nfc/url';

// A tag tap opens https://APP_DOMAIN/?t=ID. Route it to the Tag Landing and strip ?t= from the address bar.
const tagId = parseTagParam(window.location.search);
if (tagId !== null) {
  history.replaceState(null, '', `${window.location.pathname}#/tag/${encodeURIComponent(tagId)}`);
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
