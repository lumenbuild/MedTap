import { useRef, useState } from 'react';
import { format } from 'date-fns';
import { Camera, ChevronRight, FlaskConical, Plus, Trash2 } from 'lucide-react';
import type { Dose, Medication, PeptideVial } from '../../db/schema';
import { addVials, setVials, startVial, unrestock, updateVial, type VialDetails } from '../../db/repos/meds';
import { addVialPhoto, removePhoto, restorePhoto } from '../../db/repos/photos';
import { personOf } from '../../db/repos/people';
import { db } from '../../db/db';
import { useLive } from '../../db/live';
import { useDoses } from '../../app/data';
import { useNow } from '../../app/useNow';
import { useToast } from '../../app/toast';
import { fmtAmount } from '../../logic/format';
import { shownName } from '../../logic/privacy';
import { dosesFromVial, isPen, stockVials, vialsOf, vialStatus } from '../../logic/peptide';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Sheet, SheetActions } from '../../components/ui/Sheet';
import { TextArea, TextInput } from '../../components/ui/Field';
import { DrawGuide } from '../../components/Syringe';
import { usePhotoUrls } from '../Body/ProgressPhotos';
import { APP_NAME } from '../../config';

const fmtDay = (ms: number) => format(ms, 'EEE d MMM');
const fmtYmd = (ymd: string) => format(new Date(`${ymd}T12:00`), 'd MMM yyyy');
const num = (s: string) => (s.trim() === '' ? undefined : Number(s));

/** "Lot A123 · exp 3 Feb 2027 · Acme · 99%" */
function batchLine(v: PeptideVial): string {
  return [v.lot ? `Lot ${v.lot}` : '', v.expiry ? `exp ${fmtYmd(v.expiry)}` : '', v.supplier ?? '', v.purity ? `${v.purity}%` : ''].filter(Boolean).join(' · ');
}

/** The vial or pen in use, those in stock, and finished ones (with their batch details and photos). */
export function VialCard({ med }: { med: Medication }) {
  const doses = useDoses();
  const now = useNow(60_000);
  const toast = useToast();
  const [starting, setStarting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [details, setDetails] = useState<PeptideVial | null>(null);
  const [history, setHistory] = useState(false);
  if (!med.peptide || !doses) return null;
  const pen = isPen(med);
  const word = pen ? 'pen' : 'vial';
  const v = vialStatus(med, doses, now);
  const stock = stockVials(med);
  const finished = vialsOf(med).filter((x) => x.status === 'finished').sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''));

  return (
    <Card className="space-y-3">
      <h2 className="text-lg font-semibold flex items-center gap-2"><FlaskConical size={20} className="text-primary" aria-hidden="true" /> {pen ? 'Pen' : 'Vial'} in use</h2>
      {v ? (
        <button onClick={() => setDetails(v.vial)} className="w-full text-left rounded-btn bg-surface-2 p-3 flex items-start gap-2">
          <ul className="flex-1 space-y-0.5 tnum">
            <li>{pen ? 'Started' : 'Mixed'} {fmtDay(v.startedAt)}{!pen && v.vial.waterMl ? ` with ${v.vial.waterMl} mL` : ''}</li>
            <li>About <strong>{fmtAmount(v.left, med.unit)}</strong> left{med.defaultAmount > 0 ? ` · ${v.dosesLeft} dose${v.dosesLeft === 1 ? '' : 's'} of ${fmtAmount(med.defaultAmount, med.unit)}` : ''}</li>
            {v.useBy && <li className={v.expired ? 'text-danger font-semibold' : ''}>{v.expired ? `Past its use-within date (${fmtDay(v.useBy)})` : `Use by ${fmtDay(v.useBy)}`}</li>}
            {batchLine(v.vial) && <li className="text-sm text-muted">{batchLine(v.vial)}</li>}
          </ul>
          <ChevronRight className="text-muted mt-1" aria-hidden="true" />
        </button>
      ) : (
        <p className="text-muted">Tap below when you {pen ? 'start a pen' : 'mix a vial'}, and {APP_NAME} keeps count of what's left in it.</p>
      )}
      <DrawGuide med={med} amount={med.defaultAmount} />
      <Button className="w-full" onClick={() => setStarting(true)}>{pen ? "I've started a new pen" : "I've mixed a new vial"}</Button>

      <div className="pt-1">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">In stock: {stock.length} {word}{stock.length === 1 ? '' : 's'}</h3>
          <button onClick={() => setAdding(true)} className="min-h-[44px] px-2 -mr-2 text-primary font-semibold flex items-center gap-1"><Plus size={18} aria-hidden="true" /> Add</button>
        </div>
        {stock.length > 0 && (
          <ul className="mt-1 divide-y divide-border">
            {stock.map((x, i) => (
              <li key={x.id}>
                <button onClick={() => setDetails(x)} className="w-full min-h-[48px] py-2 text-left flex items-center gap-2">
                  <span className="flex-1">
                    <span className="block tnum">{fmtAmount(x.amount, med.unit)}{i === 0 ? <span className="text-sm text-primary font-medium"> · next</span> : ''}</span>
                    {batchLine(x) && <span className="block text-sm text-muted">{batchLine(x)}</span>}
                  </span>
                  <ChevronRight className="text-muted" size={18} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {finished.length > 0 && (
        <div>
          <button onClick={() => setHistory(!history)} aria-expanded={history} className="min-h-[44px] text-primary font-semibold">
            {history ? 'Hide' : 'Show'} finished {word}s ({finished.length})
          </button>
          {history && (
            <ul className="divide-y divide-border">
              {finished.map((x) => {
                const n = dosesFromVial(x, med.id, doses).length;
                return (
                  <li key={x.id}>
                    <button onClick={() => setDetails(x)} className="w-full min-h-[48px] py-2 text-left">
                      <span className="block tnum">{x.startedAt ? fmtDay(Date.parse(x.startedAt)) : '?'} – {x.finishedAt ? fmtDay(Date.parse(x.finishedAt)) : '?'} · {n} dose{n === 1 ? '' : 's'}</span>
                      {batchLine(x) && <span className="block text-sm text-muted">{batchLine(x)}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      <a href="#/supplies" className="block text-center min-h-[44px] leading-[44px] text-primary font-semibold">Supplies</a>
      {!pen && <a href="#/calc" className="block text-center min-h-[44px] leading-[44px] text-primary font-semibold">Peptide calculator</a>}

      {starting && <StartSheet med={med} stock={stock} onClose={() => setStarting(false)} onStarted={(before) => {
        toast(pen ? 'New pen: counting from now' : 'New vial: counting from now', { onAction: () => setVials(med.id, before) });
      }} />}
      {adding && <AddSheet med={med} onClose={() => setAdding(false)} />}
      {details && <DetailsSheet med={med} vial={vialsOf(med).find((x) => x.id === details.id) ?? details} doses={doses} onClose={() => setDetails(null)} />}
    </Card>
  );
}

/** Start the next vial/pen: pick from stock (soonest expiry first) or one that isn't listed; vials ask for the water. */
function StartSheet({ med, stock, onClose, onStarted }: { med: Medication; stock: PeptideVial[]; onClose: () => void; onStarted: (before: PeptideVial[] | undefined) => void }) {
  const pen = isPen(med);
  const [pick, setPick] = useState<string>(stock[0]?.id ?? 'other');
  const [water, setWater] = useState(String(med.peptide?.waterMl || ''));
  const [amount, setAmount] = useState(String(med.strength || ''));
  const waterOk = pen || Number(water) > 0;
  const start = async () => {
    if (!waterOk) return;
    const before = await startVial(med.id, pick === 'other'
      ? { details: { amount: Number(amount) || med.strength }, waterMl: pen ? undefined : Number(water) }
      : { vialId: pick, waterMl: pen ? undefined : Number(water) });
    onStarted(before);
    onClose();
  };
  return (
    <Sheet open onClose={onClose} title={pen ? 'Start a new pen' : 'Mix a new vial'}>
      <div className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium mb-1">Which {pen ? 'pen' : 'vial'}?</legend>
          {stock.map((x, i) => (
            <label key={x.id} className="flex items-start gap-3 min-h-[48px] rounded-btn bg-surface-2 p-3">
              <input type="radio" name="vial" checked={pick === x.id} onChange={() => setPick(x.id)} className="mt-1 accent-[var(--primary)]" />
              <span><span className="block">{fmtAmount(x.amount, med.unit)}{i === 0 ? ' (next: soonest expiry)' : ''}</span>
                {batchLine(x) && <span className="block text-sm text-muted">{batchLine(x)}</span>}</span>
            </label>
          ))}
          <label className="flex items-start gap-3 min-h-[48px] rounded-btn bg-surface-2 p-3">
            <input type="radio" name="vial" checked={pick === 'other'} onChange={() => setPick('other')} className="mt-1 accent-[var(--primary)]" />
            <span>{stock.length ? 'One not in the list' : `A ${pen ? 'pen' : 'vial'} (none in stock in ${APP_NAME})`}</span>
          </label>
        </fieldset>
        {pick === 'other' && (
          <TextInput label={`Amount in it (${med.unit})`} type="number" inputMode="decimal" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} />
        )}
        {!pen && (
          <TextInput label="Water added (mL)" help="Units for this vial are worked out from this." type="number" inputMode="decimal" min="0" step="any"
            value={water} onChange={(e) => setWater(e.target.value)} error={waterOk ? undefined : 'Enter the water you added.'} />
        )}
        <p className="text-sm text-muted">The {pen ? 'pen' : 'vial'} in use now is marked finished.</p>
        <SheetActions>
          <Button className="w-full min-h-[56px]" disabled={!waterOk} onClick={start}>{pen ? 'Start this pen' : 'Mixed'}</Button>
        </SheetActions>
      </div>
    </Sheet>
  );
}

function BatchFields({ v, set, unit }: { v: Record<'amount' | 'lot' | 'supplier' | 'purity' | 'expiry' | 'note', string>; set: (k: keyof typeof v, x: string) => void; unit: string }) {
  return (
    <>
      <TextInput label={`Amount in each (${unit})`} type="number" inputMode="decimal" min="0" step="any" value={v.amount} onChange={(e) => set('amount', e.target.value)} />
      <div className="grid grid-cols-2 gap-3">
        <TextInput label="Lot / batch (optional)" value={v.lot} onChange={(e) => set('lot', e.target.value)} autoComplete="off" />
        <TextInput label="Expiry (optional)" type="date" value={v.expiry} onChange={(e) => set('expiry', e.target.value)} />
      </div>
      <div className="grid grid-cols-[1fr_7rem] gap-3">
        <TextInput label="Supplier (optional)" value={v.supplier} onChange={(e) => set('supplier', e.target.value)} autoComplete="off" />
        <TextInput label="Purity % (optional)" type="number" inputMode="decimal" min="0" max="100" step="any" value={v.purity} onChange={(e) => set('purity', e.target.value)} />
      </div>
      <TextArea label="Note (optional)" rows={2} value={v.note} onChange={(e) => set('note', e.target.value)} />
    </>
  );
}

const toDetails = (v: Record<'amount' | 'lot' | 'supplier' | 'purity' | 'expiry' | 'note', string>, fallback: number): VialDetails => ({
  amount: Number(v.amount) || fallback, lot: v.lot.trim() || undefined, supplier: v.supplier.trim() || undefined,
  purity: num(v.purity), expiry: v.expiry || undefined, note: v.note.trim() || undefined,
});

function AddSheet({ med, onClose }: { med: Medication; onClose: () => void }) {
  const toast = useToast();
  const pen = isPen(med);
  const [count, setCount] = useState('1');
  const [v, setV] = useState({ amount: String(med.strength || ''), lot: '', supplier: '', purity: '', expiry: '', note: '' });
  const n = Number(count);
  const save = async () => {
    const ids = await addVials(med.id, n, toDetails(v, med.strength));
    toast(`Added ${n} ${pen ? 'pen' : 'vial'}${n === 1 ? '' : 's'} to stock`, {
      onAction: async () => {
        const m = await db.medications.get(med.id);
        if (m) await setVials(med.id, vialsOf(m).filter((x) => !ids.includes(x.id)));
        await unrestock(med.id, n, false);
      },
    });
    onClose();
  };
  return (
    <Sheet open onClose={onClose} title={`Add ${pen ? 'pens' : 'vials'} to stock`}>
      <div className="space-y-4">
        <TextInput label={`How many ${pen ? 'pens' : 'vials'}`} type="number" inputMode="numeric" min="1" step="1" value={count} onChange={(e) => setCount(e.target.value)} />
        <BatchFields v={v} set={(k, x) => setV((p) => ({ ...p, [k]: x }))} unit={med.unit} />
        <p className="text-sm text-muted">Same details for all of them. Add photos of the label or certificate from each one's page.</p>
        <SheetActions>
          <Button className="w-full min-h-[56px]" disabled={!(Number.isInteger(n) && n >= 1 && n <= 50)} onClick={save}>Add to stock</Button>
        </SheetActions>
      </div>
    </Sheet>
  );
}

/** One vial/pen: batch details, photos of its label and certificate, and the doses from it. */
function DetailsSheet({ med, vial, doses, onClose }: { med: Medication; vial: PeptideVial; doses: Dose[]; onClose: () => void }) {
  const toast = useToast();
  const [v, setV] = useState({
    amount: String(vial.amount), lot: vial.lot ?? '', supplier: vial.supplier ?? '', purity: vial.purity !== undefined ? String(vial.purity) : '',
    expiry: vial.expiry ?? '', note: vial.note ?? '',
  });
  const photos = useLive(() => db.photos.filter((p) => p.vialId === vial.id && !p.deletedAt).toArray(), [vial.id]) ?? [];
  const urls = usePhotoUrls(photos);
  const fileRef = useRef<HTMLInputElement>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const used = dosesFromVial(vial, med.id, doses);
  const save = async () => { await updateVial(med.id, vial.id, toDetails(v, vial.amount)); toast('Saved'); onClose(); };
  const remove = async () => {
    const m = await db.medications.get(med.id);
    if (!m) return;
    const before = vialsOf(m);
    await setVials(med.id, before.filter((x) => x.id !== vial.id));
    toast('Removed from the list', { onAction: () => setVials(med.id, before) });
    onClose();
  };
  const status = vial.status === 'in-use' ? 'In use' : vial.status === 'stock' ? 'In stock' : 'Finished';
  return (
    <Sheet open onClose={onClose} title={`${status}: ${shownName(med)}`}>
      <div className="space-y-4">
        {vial.startedAt && <p className="text-sm text-muted tnum">{isPen(med) ? 'Started' : 'Mixed'} {fmtDay(Date.parse(vial.startedAt))}{vial.waterMl ? ` with ${vial.waterMl} mL` : ''} · {used.length} dose{used.length === 1 ? '' : 's'} logged from it</p>}
        <BatchFields v={v} set={(k, x) => setV((p) => ({ ...p, [k]: x }))} unit={med.unit} />
        <div>
          <p className="text-sm font-medium mb-2">Photos (label, certificate of analysis)</p>
          <div className="grid grid-cols-3 gap-2">
            {photos.map((p) => (
              <div key={p.id} className="relative">
                <button onClick={() => setViewing(urls.get(p.id) ?? null)} className="block w-full aspect-square rounded-btn overflow-hidden bg-surface-2">
                  {urls.get(p.id) && <img src={urls.get(p.id)} alt="Vial photo" className="w-full h-full object-cover" />}
                </button>
                <button aria-label="Delete photo" onClick={async () => { await removePhoto(p.id); toast('Photo deleted', { onAction: () => restorePhoto(p.id) }); }}
                  className="absolute top-1 right-1 w-9 h-9 rounded-full bg-surface/90 flex items-center justify-center"><Trash2 size={16} aria-hidden="true" /></button>
              </div>
            ))}
            <button onClick={() => fileRef.current?.click()} className="aspect-square rounded-btn bg-surface-2 flex flex-col items-center justify-center gap-1 text-primary font-semibold text-sm">
              <Camera aria-hidden="true" /> Add photo
            </button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) await addVialPhoto(vial.id, f, personOf(med));
          }} />
          <p className="text-xs text-muted mt-1">Kept on this phone only.</p>
        </div>
        <SheetActions>
          <Button className="w-full min-h-[56px]" onClick={save}>Save</Button>
        </SheetActions>
        <Button variant="danger" className="w-full" onClick={remove}>Remove from the list</Button>
      </div>
      {viewing && (
        <div role="dialog" aria-label="Photo" className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center" onClick={() => setViewing(null)}>
          <img src={viewing} alt="Vial photo, full size" className="max-w-full max-h-full" />
        </div>
      )}
    </Sheet>
  );
}

/** Today: a vial or pen past its use-within date, or about to run out. */
export function VialAlerts({ meds, doses, now }: { meds: Medication[]; doses: Dose[]; now: number }) {
  const alerts = meds.filter((m) => m.peptide && !m.archived).map((m) => ({ m, v: vialStatus(m, doses, now) }))
    .filter((x): x is { m: Medication; v: NonNullable<typeof x.v> } => !!x.v && (x.v.expired || x.v.dosesLeft <= 1));
  if (!alerts.length) return null;
  return (
    <>
      {alerts.map(({ m, v }) => {
        const word = isPen(m) ? 'pen' : 'vial';
        return (
          <Card key={m.id} className="bg-caution-soft shadow-none flex gap-3">
            <FlaskConical className="text-caution shrink-0 mt-0.5" aria-hidden="true" />
            <div className="flex-1 space-y-2">
              <p><strong>{shownName(m)} {word}:</strong>{' '}
                {v.expired ? `past its use-within date (${isPen(m) ? 'started' : 'mixed'} ${fmtDay(v.startedAt)}).` : v.dosesLeft === 0 ? 'probably empty.' : 'about 1 dose left.'}
                {' '}{stockVials(m).length ? `${stockVials(m).length} in stock.` : `None in stock in ${APP_NAME}.`}
              </p>
              <Button variant="secondary" onClick={() => { location.hash = `#/meds/${m.id}`; }}>{isPen(m) ? 'Start a new pen' : 'Mix a new vial'}</Button>
            </div>
          </Card>
        );
      })}
    </>
  );
}


