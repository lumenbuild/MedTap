import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import './styles/index.css';
import { App } from './app/App';
import { ErrorBoundary } from './app/ErrorBoundary';
import { parseTagParam } from './nfc/url';
import { getSettings, scheduleSettings } from './db/repos/settings';
import { applyDuePlannedChanges } from './db/repos/meds';
import { dayKey } from './logic/stats';
import { isNative } from './platform';
import { getSyncConfig, initSync } from './app/sync';

// A tag tap opens https://APP_DOMAIN/?t=ID. Route it to the Tag Landing and strip ?t= from the address bar.
const tagId = parseTagParam(window.location.search);
if (tagId !== null) {
  history.replaceState(null, '', `${window.location.pathname}#/tag/${encodeURIComponent(tagId)}`);
}

const render = () => createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

// Apply any planned schedule change due today before the first screen, so a tag tap that morning already
// uses the new amounts. Never hold the app back for long if storage is slow.
const ready = getSettings().then((st) => applyDuePlannedChanges(dayKey(Date.now(), scheduleSettings(st)), st.dayStartsAt));
Promise.race([ready, new Promise((r) => setTimeout(r, 1500))]).catch((e) => console.error(e)).finally(render);

// Family sync, if this phone has joined.
void getSyncConfig().then((c) => { if (c) initSync(); });

// Inside the iOS/Android app: tag taps, links and reminder notifications.
if (isNative) void import('./app/native').then((m) => m.initNative()).catch((e) => console.error('native', e));
