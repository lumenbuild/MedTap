// Ask Today to open "Log dose" for a medication, e.g. after tapping a reminder notification.
type Listener = (medId: string) => void;
let pending: string | null = null;
const listeners = new Set<Listener>();

export function requestLog(medId: string) {
  pending = medId;
  listeners.forEach((l) => l(medId));
}

/** Today subscribes; a request made before Today was on screen is delivered straight away. */
export function onLogRequest(l: Listener): () => void {
  listeners.add(l);
  if (pending) l(pending);
  return () => { listeners.delete(l); };
}

export function clearLogRequest() { pending = null; }
