// Which view this session unlocked into (full or private), until the app locks again. Kept in memory only, so a
// restart always asks for a PIN again.
import { useSyncExternalStore } from 'react';
import type { ViewMode } from '../logic/privateView';

let mode: ViewMode = 'full';
const listeners = new Set<() => void>();

export function setViewMode(m: ViewMode) {
  if (m === mode) return;
  mode = m;
  listeners.forEach((l) => l());
}
export const viewMode = () => mode;
export const isPrivateView = () => mode === 'private';
export const useViewMode = () => useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => mode);
