import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Delete, Lock } from 'lucide-react';
import { useSettings } from './data';
import { verifyPin } from '../logic/pin';
import { setViewMode } from './viewMode';
import { useHashRoute } from './router';
import type { ViewMode } from '../logic/privateView';
import { eraseAll } from '../db/repos/backup';
import { APP_NAME } from '../config';
import { Button } from '../components/ui/Button';
import { Sheet, SheetActions } from '../components/ui/Sheet';
import { TextInput } from '../components/ui/Field';

/** Covers the app with a PIN pad when app lock is on: at start, after leaving the app, or after being idle. The main
 *  PIN opens everything; the privacy PIN (if set) opens the private view, which looks the same. */
const LOCK_NOW = 'app-lock-now';
/** Lock straight away (Settings → Privacy → Lock now), e.g. before handing the phone over or to switch views. */
export const lockNow = () => window.dispatchEvent(new Event(LOCK_NOW));

export function LockGate({ children }: { children: ReactNode }) {
  const settings = useSettings();
  const enabled = !!settings?.lockEnabled && !!settings.pinHash && !!settings.pinSalt;
  const [locked, setLocked] = useState<boolean | null>(null);
  const lastActive = useRef(Date.now());
  const hiddenAt = useRef<number | null>(null);
  const afterMs = (settings?.lockAfterMin ?? 5) * 60_000;
  // "Ask for the PIN on every tag tap": a tag route asks again unless this very tap was just unlocked. Read from the
  // address itself so the tag screen (which logs) is never shown first, even for a moment.
  useHashRoute();
  const route = window.location.hash.replace(/^#/, '');
  const onTag = route.startsWith('/tag/');
  const [tagUnlocked, setTagUnlocked] = useState<string | null>(null);
  useEffect(() => { if (!onTag) setTagUnlocked(null); }, [onTag]);
  const tagPin = enabled && !!settings?.tagNeedsPin && onTag && tagUnlocked !== route;

  // Lock on first load if enabled; unlock immediately if it gets turned off.
  useEffect(() => {
    if (!settings) return;
    setLocked((cur) => (enabled ? (cur === null ? true : cur) : false));
    if (!enabled) setViewMode('full');
  }, [settings, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const touch = () => { lastActive.current = Date.now(); };
    const onVis = () => {
      if (document.visibilityState === 'hidden') hiddenAt.current = Date.now();
      else if (hiddenAt.current !== null && Date.now() - hiddenAt.current >= afterMs) setLocked(true);
    };
    const idle = setInterval(() => { if (Date.now() - lastActive.current >= Math.max(afterMs, 60_000)) setLocked(true); }, 15_000);
    ['pointerdown', 'keydown', 'scroll'].forEach((e) => window.addEventListener(e, touch, { passive: true }));
    document.addEventListener('visibilitychange', onVis);
    const now = () => setLocked(true);
    window.addEventListener(LOCK_NOW, now);
    return () => {
      clearInterval(idle);
      window.removeEventListener(LOCK_NOW, now);
      ['pointerdown', 'keydown', 'scroll'].forEach((e) => window.removeEventListener(e, touch));
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [enabled, afterMs]);

  const unlock = useCallback((mode: ViewMode) => {
    setViewMode(mode); lastActive.current = Date.now(); setLocked(false);
    const r = window.location.hash.replace(/^#/, '');
    if (r.startsWith('/tag/')) setTagUnlocked(r);
  }, []);

  if (settings === undefined || locked === null) return null;
  if (enabled && (locked || tagPin)) return <LockScreen salt={settings.pinSalt!} hash={settings.pinHash!} length={settings.pinLength} onUnlock={unlock}
    privacy={settings.privacyPinHash && settings.privacyPinSalt ? { salt: settings.privacyPinSalt, hash: settings.privacyPinHash } : null} />;
  return <>{children}</>;
}

function LockScreen({ salt, hash, length, onUnlock, privacy }: { salt: string; hash: string; length: number; onUnlock: (m: ViewMode) => void; privacy: { salt: string; hash: string } | null }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [fails, setFails] = useState(0);
  const [waitUntil, setWaitUntil] = useState(0);
  const [forgot, setForgot] = useState(false);
  const [typed, setTyped] = useState('');
  const [, tick] = useState(0);
  const waiting = waitUntil > Date.now();

  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [waiting]);

  const tryPin = async (p: string) => {
    if (await verifyPin(p, salt, hash)) { onUnlock('full'); return; }
    if (privacy && await verifyPin(p, privacy.salt, privacy.hash)) { onUnlock('private'); return; }
    const n = fails + 1;
    setFails(n);
    setPin('');
    if (n % 5 === 0) { setWaitUntil(Date.now() + 30_000); setError('Too many tries. Wait 30 seconds.'); }
    else setError("That PIN isn't right.");
  };
  const press = (d: string) => {
    if (waiting) return;
    setError('');
    const p = (pin + d).slice(0, length);
    setPin(p);
    if (p.length === length) tryPin(p).catch(() => {});
  };

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center px-6 py-8" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <Lock size={36} className="text-primary" aria-hidden="true" />
      <h1 className="text-2xl font-semibold mt-3">{APP_NAME} is locked</h1>
      <p className="text-muted mt-1">Enter your PIN</p>
      <div className="flex gap-3 my-6" aria-label={`${pin.length} digits entered`} role="status">
        {Array.from({ length }, (_, i) => (
          <span key={i} className={`w-3.5 h-3.5 rounded-full border-2 ${i < pin.length ? 'bg-primary border-primary' : 'border-border'}`} />
        ))}
      </div>
      <p className="min-h-[24px] text-danger text-sm tnum" role="alert">
        {error}{waiting ? ` ${Math.ceil((waitUntil - Date.now()) / 1000)}s` : ''}
      </p>
      <div className="grid grid-cols-3 gap-3 mt-2 w-full max-w-[300px]">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} onClick={() => press(d)} disabled={waiting} className="h-16 rounded-full border border-border-strong text-2xl font-semibold tnum disabled:opacity-40">{d}</button>
        ))}
        <span />
        <button onClick={() => press('0')} disabled={waiting} className="h-16 rounded-full border border-border-strong text-2xl font-semibold tnum disabled:opacity-40">0</button>
        <button onClick={() => { setPin(pin.slice(0, -1)); setError(''); }} aria-label="Delete digit" className="h-16 rounded-full flex items-center justify-center"><Delete aria-hidden="true" /></button>
      </div>
      <button onClick={() => setForgot(true)} className="mt-6 min-h-[48px] px-3 text-primary font-semibold">Forgot PIN?</button>

      <Sheet open={forgot} onClose={() => setForgot(false)} title="Forgot your PIN?">
        <div className="space-y-4">
          <p>The PIN can't be recovered. The only way back in is to erase everything on this phone, then restore from a backup if you have one.</p>
          <TextInput label="Type ERASE to erase this phone's data" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="characters" />
          <SheetActions>
            <Button variant="danger" className="w-full min-h-[56px]" disabled={typed.trim() !== 'ERASE'}
              onClick={async () => { await eraseAll(); window.location.replace(window.location.pathname); }}>Erase everything</Button>
          </SheetActions>
        </div>
      </Sheet>
    </div>
  );
}
