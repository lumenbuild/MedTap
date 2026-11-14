// What a log button says when it's done: what was logged, with Undo. A second tap on the same thing within a minute
// isn't logged again (see logic/duplicate.ts); it says so, with "Log again" for the rare time it really was twice.
import { fmtTime } from '../logic/format';

type Toast = (message: string, opts?: { actionLabel?: string; onAction?: () => void; duration?: number }) => void;

export function sayLogged(toast: Toast, rec: { duplicate?: boolean; at?: string; takenAt?: string; createdAt?: string }, message: string,
  undo?: () => unknown, again?: () => unknown) {
  if (rec.duplicate) {
    const t = Date.parse(rec.takenAt ?? rec.at ?? rec.createdAt ?? '');
    toast(`Already logged${Number.isFinite(t) ? ` at ${fmtTime(t)}` : ''}`, again ? { actionLabel: 'Log again', onAction: () => { void again(); } } : {});
    return;
  }
  toast(message, undo ? { onAction: () => { void undo(); } } : {});
}
