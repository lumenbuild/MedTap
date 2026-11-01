// A recipe link shared to the app (Share > MedTap): the Food screen opens the import with it.
let pending: string | null = null;
const listeners = new Set<(url: string) => void>();
export function requestRecipe(url: string) { pending = url; listeners.forEach((l) => l(url)); }
export function onRecipeRequest(l: (url: string) => void): () => void { listeners.add(l); if (pending) l(pending); return () => { listeners.delete(l); }; }
export function clearRecipeRequest() { pending = null; }
