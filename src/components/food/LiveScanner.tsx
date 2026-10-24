// Live barcode scanning: the camera's picture full screen with a guide, read a few times a second until a barcode
// with a valid check digit turns up. Nothing is recorded. Falls back to a photo or typing the numbers.
import { useEffect, useRef, useState } from 'react';
import { Camera, Flashlight, Keyboard, X } from 'lucide-react';
import { frameReader, validBarcode } from '../../app/barcode';

type State = 'starting' | 'scanning' | 'denied' | 'unavailable';

export function LiveScanner({ onCode, onPhoto, onType, onClose }: {
  onCode: (code: string) => void; onPhoto: () => void; onType: () => void; onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const track = useRef<MediaStreamTrack | null>(null);
  const [state, setState] = useState<State>('starting');
  const [torch, setTorch] = useState<boolean | null>(null);
  // Latest callbacks, so the camera effect runs once.
  const done = useRef(onCode);
  done.current = onCode;

  useEffect(() => {
    let stream: MediaStream | undefined;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    closeBtn.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setState('unavailable'); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      } catch (e) {
        setState((e as Error).name === 'NotAllowedError' || (e as Error).name === 'SecurityError' ? 'denied' : 'unavailable');
        return;
      }
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
      const v = video.current!;
      v.srcObject = stream;
      await v.play().catch(() => undefined);
      track.current = stream.getVideoTracks()[0] ?? null;
      const caps = (track.current?.getCapabilities?.() ?? {}) as { torch?: boolean };
      if (caps.torch) setTorch(false);
      setState('scanning');
      const read = await frameReader();
      // The same code twice in a row, so a half-seen barcode can't slip through.
      let last = '';
      const tick = async () => {
        if (stopped) return;
        const code = await read(v).catch(() => null);
        if (code && validBarcode(code)) {
          if (code === last) {
            stopped = true;
            navigator.vibrate?.(40);
            stream?.getTracks().forEach((t) => t.stop());
            done.current(code);
            return;
          }
          last = code;
        }
        timer = setTimeout(tick, 120);
      };
      void tick();
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      document.body.style.overflow = overflow;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const flip = async () => {
    const next = !torch;
    try { await track.current?.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] }); setTorch(next); } catch { setTorch(null); }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Scan a barcode" className="fixed inset-0 z-[60] bg-black text-white flex flex-col">
      <div className="relative flex-1 overflow-hidden">
        <video ref={video} muted playsInline className="absolute inset-0 w-full h-full object-cover" aria-hidden="true" />
        {state === 'scanning' && (
          <div aria-hidden="true" className="absolute left-[8%] right-[8%] top-1/2 -translate-y-1/2 aspect-[2/1] rounded-2xl border-[3px] border-white/90" style={{ boxShadow: '0 0 0 100vmax rgba(0,0,0,.45)' }}>
            <div className="absolute inset-x-4 top-1/2 h-0.5 bg-white/70" />
          </div>
        )}
        <div className="absolute top-0 inset-x-0 flex items-center justify-between p-3" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }}>
          <p className="text-[17px] font-medium px-2" aria-live="polite">
            {state === 'starting' ? 'Starting the camera…' : state === 'scanning' ? 'Point at the barcode' : state === 'denied' ? 'Camera not allowed' : 'No camera here'}
          </p>
          <button ref={closeBtn} type="button" aria-label="Close" onClick={onClose} className="w-12 h-12 rounded-full bg-black/50 flex items-center justify-center"><X size={24} aria-hidden="true" /></button>
        </div>
        {(state === 'denied' || state === 'unavailable') && (
          <p className="absolute inset-x-6 top-1/3 text-center text-[17px]">
            {state === 'denied' ? 'Allow the camera for this app in your phone’s settings, or take a photo of the barcode instead.' : 'Take a photo of the barcode instead, or type its numbers.'}
          </p>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 p-3 bg-black" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}>
        <button type="button" onClick={onPhoto} className="min-h-[64px] rounded-btn bg-white/10 flex flex-col items-center justify-center gap-1 text-[13px]"><Camera size={22} aria-hidden="true" />Photo instead</button>
        <button type="button" onClick={onType} className="min-h-[64px] rounded-btn bg-white/10 flex flex-col items-center justify-center gap-1 text-[13px]"><Keyboard size={22} aria-hidden="true" />Type numbers</button>
        <button type="button" disabled={torch === null} aria-pressed={!!torch} onClick={flip} className="min-h-[64px] rounded-btn bg-white/10 flex flex-col items-center justify-center gap-1 text-[13px] disabled:opacity-40"><Flashlight size={22} aria-hidden="true" />{torch === null ? 'No torch' : torch ? 'Torch off' : 'Torch'}</button>
      </div>
    </div>
  );
}
