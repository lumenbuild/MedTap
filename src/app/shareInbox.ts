import type { ScaleReading } from '../logic/scaleImport';

// A recipe link shared to the app (Share > MedTap): the Food screen opens the import with it.
let pending: string | null = null;
const listeners = new Set<(url: string) => void>();
export function requestRecipe(url: string) { pending = url; listeners.forEach((l) => l(url)); }
export function onRecipeRequest(l: (url: string) => void): () => void { listeners.add(l); if (pending) l(pending); return () => { listeners.delete(l); }; }
export function clearRecipeRequest() { pending = null; }

// A scale reading read from a shared screenshot, waiting for Body to show it for checking.
let pendingScale: ScaleReading | null = null;
let scaleListener: ((r: ScaleReading) => void) | null = null;
export function requestScaleReview(r: ScaleReading) { pendingScale = r; scaleListener?.(r); }
export function onScaleReview(l: (r: ScaleReading) => void) { scaleListener = l; if (pendingScale) l(pendingScale); return () => { if (scaleListener === l) scaleListener = null; }; }
export function clearScaleReview() { pendingScale = null; }
