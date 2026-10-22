// Take or choose a photo and read its text on this phone (on-device OCR); the photo isn't kept or sent anywhere.
import { useRef, useState } from 'react';
import { Camera, ImageUp } from 'lucide-react';
import { Button } from './ui/Button';

export function PhotoReader({ onText, what }: { onText: (text: string) => void; what: string }) {
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ busy: boolean; progress: number; error?: string }>({ busy: false, progress: 0 });
  const read = async (file?: File) => {
    if (!file) return;
    setState({ busy: true, progress: 0 });
    try {
      const { readText } = await import('../app/ocr');
      const text = await readText(file, (progress) => setState({ busy: true, progress }));
      setState({ busy: false, progress: 1 });
      onText(text);
    } catch (e) {
      console.error('ocr', e);
      setState({ busy: false, progress: 0, error: navigator.onLine ? `Couldn't read the photo. Try again, or type it in.` : 'The first photo needs an internet connection to download the reader.' });
    }
  };
  return (
    <div className="space-y-2">
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void read(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={library} type="file" accept="image/*" className="hidden" onChange={(e) => { void read(e.target.files?.[0]); e.target.value = ''; }} />
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" disabled={state.busy} className="flex items-center justify-center gap-2" onClick={() => camera.current?.click()}><Camera size={18} aria-hidden="true" /> Photo of {what}</Button>
        <Button variant="secondary" disabled={state.busy} className="flex items-center justify-center gap-2" onClick={() => library.current?.click()}><ImageUp size={18} aria-hidden="true" /> Choose photo</Button>
      </div>
      {state.busy && <p className="text-sm text-muted" aria-live="polite">Reading… {Math.round(state.progress * 100)}%</p>}
      {state.error && <p role="alert" className="text-sm text-caution">{state.error}</p>}
      <p className="text-xs text-muted">Read on this phone; the photo isn't kept or sent anywhere. Check what it fills in.</p>
    </div>
  );
}
