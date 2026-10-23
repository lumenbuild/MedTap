import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Columns2, Lock } from 'lucide-react';
import type { Photo } from '../../db/schema';
import { db } from '../../db/db';
import { useLive } from '../../db/live';
import { addPhoto, removePhoto, restorePhoto } from '../../db/repos/photos';
import { personOf } from '../../db/repos/people';
import { useToast } from '../../app/toast';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Sheet, SheetActions } from '../../components/ui/Sheet';
import { todayYmd } from '../../components/BodySheets';
import { fmtYmdDay } from '../../logic/format';

const fmtYmd = (ymd: string) => fmtYmdDay(ymd);

/** Object URLs for photo blobs, released when no longer shown. */
export function usePhotoUrls(photos: Photo[]) {
  const urls = useMemo(() => new Map(photos.map((p) => [p.id, URL.createObjectURL(p.blob)])), [photos]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  return urls;
}

export function ProgressPhotos({ personId }: { personId: string }) {
  const all = useLive(() => db.photos.orderBy('date').toArray());
  const photos = useMemo(() => (all ?? []).filter((p) => !p.deletedAt && !p.vialId && personOf(p) === personId), [all, personId]);
  const urls = usePhotoUrls(photos);
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [date, setDate] = useState(todayYmd());
  const [viewing, setViewing] = useState<Photo | null>(null);
  const [compare, setCompare] = useState<[string, string] | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const p = await addPhoto(date, file, personId);
      toast(`Photo saved for ${fmtYmd(p.date)}`, { onAction: () => removePhoto(p.id) });
    } finally { setBusy(false); }
  };

  return (
    <Card>
      <h2 className="text-sm font-medium text-muted">Progress photos</h2>
      <p className="text-sm text-muted flex items-center gap-1.5 mt-1"><Lock size={14} aria-hidden="true" /> Stored only on this phone. Never uploaded.</p>

      {photos.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 mt-3">
          {[...photos].reverse().map((p) => (
            <li key={p.id}>
              <button onClick={() => setViewing(p)} className="block w-full aspect-[3/4] rounded-btn overflow-hidden bg-surface-2 relative">
                <img src={urls.get(p.id)} alt={`Progress photo, ${fmtYmd(p.date)}`} className="w-full h-full object-cover" />
                <span className="absolute bottom-0 inset-x-0 bg-black/50 text-white text-xs py-1 tnum">{fmtYmd(p.date)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 grid grid-cols-[1fr_auto] gap-2 items-end">
        <label className="block space-y-1">
          <span className="block text-sm font-medium">Photo date</span>
          <input type="date" value={date} max={todayYmd()} onChange={(e) => e.target.value && setDate(e.target.value)}
            className="w-full min-h-[48px] rounded-btn bg-surface-2 border border-border px-3 tnum" />
        </label>
        <Button variant="secondary" className="flex items-center gap-2" onClick={() => fileRef.current?.click()} disabled={busy}>
          <Camera size={20} aria-hidden="true" /> Add photo
        </Button>
      </div>
      <input ref={fileRef} type="file" accept="image/*" className="sr-only" aria-label="Choose photo"
        onChange={(e) => { add(e.target.files?.[0]); e.target.value = ''; }} />
      {photos.length >= 2 && (
        <Button variant="secondary" className="w-full mt-2 flex items-center justify-center gap-2"
          onClick={() => setCompare([photos[0].id, photos[photos.length - 1].id])}>
          <Columns2 size={20} aria-hidden="true" /> Compare side by side
        </Button>
      )}

      <Sheet open={!!viewing} onClose={() => setViewing(null)} title={viewing ? fmtYmd(viewing.date) : ''}>
        {viewing && (
          <div className="space-y-4">
            <img src={urls.get(viewing.id)} alt={`Progress photo, ${fmtYmd(viewing.date)}`} className="w-full rounded-btn" />
            <SheetActions>
              <Button variant="danger" className="w-full" onClick={async () => {
                const id = viewing.id; await removePhoto(id); setViewing(null);
                toast('Photo deleted', { onAction: () => restorePhoto(id) });
              }}>Delete photo</Button>
            </SheetActions>
          </div>
        )}
      </Sheet>

      <Sheet open={!!compare} onClose={() => setCompare(null)} title="Compare">
        {compare && (
          <div className="grid grid-cols-2 gap-2">
            {compare.map((id, i) => (
              <div key={i} className="space-y-2">
                <select aria-label={i === 0 ? 'Left photo' : 'Right photo'} value={id}
                  onChange={(e) => setCompare(i === 0 ? [e.target.value, compare[1]] : [compare[0], e.target.value])}
                  className="w-full min-h-[48px] rounded-btn bg-surface-2 border border-border px-2 text-sm">
                  {photos.map((p) => <option key={p.id} value={p.id}>{fmtYmd(p.date)}</option>)}
                </select>
                <img src={urls.get(id)} alt={`Progress photo, ${fmtYmd(photos.find((p) => p.id === id)?.date ?? '')}`} className="w-full rounded-btn" />
              </div>
            ))}
          </div>
        )}
      </Sheet>
    </Card>
  );
}
