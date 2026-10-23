// Every tag on this phone in one place: medication tags (managed on each medication) and the others (exercises,
// routines, water, scales and so on), with a way to link a new one.
import { useState } from 'react';
import { ChevronRight, Nfc, Plus } from 'lucide-react';
import { DEFAULT_PERSON, type Tag, type TagAction } from '../../db/schema';
import { useExercises, useFamily, useMeds, useRoutines, useTags } from '../../app/data';
import { linkActionTag, renameTag, restoreTag, unlinkTag } from '../../db/repos/tags';
import { personOf } from '../../db/repos/people';
import { allExercises } from '../../logic/exercises';
import { actionTitle } from '../../logic/tagActions';
import { shownName } from '../../logic/privacy';
import { fmtAgo } from '../../logic/format';
import { tagUrl } from '../../nfc/url';
import { useNow } from '../../app/useNow';
import { useToast } from '../../app/toast';
import { Button } from '../../components/ui/Button';
import { TextInput } from '../../components/ui/Field';
import { Sheet } from '../../components/ui/Sheet';
import { WriteTagSheet } from '../Meds/LinkTagSheet';
import { QrSheet } from '../Meds/QrSheet';
import { TagTest } from '../Meds/TagTest';
import { tagName } from '../Meds/TagsSection';
import { ActionPicker } from './ActionPicker';

export function Tags() {
  const tags = useTags(); const meds = useMeds(); const own = useExercises(); const routines = useRoutines(); const fam = useFamily();
  const now = useNow(60_000);
  const [choosing, setChoosing] = useState(false);
  const [writing, setWriting] = useState<{ action: TagAction; label: string } | null>(null);
  const [selected, setSelected] = useState<Tag | null>(null);
  const [qr, setQr] = useState<{ url: string; name: string } | null>(null);
  if (!tags || !meds || !own || !routines || !fam) return <div className="h-60 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;
  const defs = allExercises(own);
  const medTags = tags.filter((t) => t.medicationId && meds.some((m) => m.id === t.medicationId));
  const others = tags.filter((t) => t.action && (fam.everyone || !fam.many || personOf(t) === fam.personId));
  const what = (t: Tag) => (t.action ? actionTitle(t.action, defs, routines) : '');
  const last = (t: Tag) => (t.lastScannedAt ? `last tapped ${fmtAgo(now - Date.parse(t.lastScannedAt))}` : 'not tapped yet');

  return (
    <div className="space-y-4">
      <section aria-labelledby="ot-h">
        <h2 id="ot-h" className="text-sm font-medium text-muted mb-1">Training and everyday</h2>
        {others.length === 0 && <p className="text-muted">None yet. Stick one on a gym machine, a water bottle or the scales.</p>}
        <ul>
          {others.map((t) => (
            <li key={t.id} className="border-t border-border">
              <button type="button" onClick={() => setSelected(t)} className="w-full min-h-[56px] flex items-center gap-3 py-2 text-left">
                <Nfc className="text-primary shrink-0" aria-hidden="true" />
                <span className="flex-1">
                  <span className="block font-medium">{tagName(t)}</span>
                  <span className="block text-sm text-muted">{what(t)}{fam.many ? ` · ${fam.nameOf(personOf(t))}` : ''} · {last(t)}</span>
                </span>
                <ChevronRight size={18} className="text-muted" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <Button className="w-full mt-2 flex items-center justify-center gap-2" onClick={() => setChoosing(true)}><Plus size={20} aria-hidden="true" /> Link a new tag</Button>
      </section>

      <section aria-labelledby="mt-h" className="pt-2">
        <h2 id="mt-h" className="text-sm font-medium text-muted mb-1">Medications</h2>
        {medTags.length === 0 && <p className="text-muted">None yet. Link one from a medication’s page in Meds.</p>}
        <ul>
          {medTags.map((t) => {
            const m = meds.find((x) => x.id === t.medicationId)!;
            return (
              <li key={t.id} className="border-t border-border">
                <a href={`#/meds/${m.id}`} className="min-h-[56px] flex items-center gap-3 py-2">
                  <Nfc className="text-primary shrink-0" aria-hidden="true" />
                  <span className="flex-1">
                    <span className="block font-medium">{shownName(m)}{t.vialId ? ' · vial tag' : ''}</span>
                    <span className="block text-sm text-muted">{tagName(t)} · {last(t)}</span>
                  </span>
                  <ChevronRight size={18} className="text-muted" aria-hidden="true" />
                </a>
              </li>
            );
          })}
        </ul>
      </section>

      <Sheet open={choosing} onClose={() => setChoosing(false)} title="What should the tag do?">
        <ActionPicker onPicked={(action, label) => { setChoosing(false); setWriting({ action, label }); }} />
      </Sheet>
      {writing && (
        <WriteTagSheet open onClose={() => setWriting(null)} onQr={(url) => setQr({ url, name: writing.label })} name={writing.label} title={`Link a tag: ${writing.label}`}
          defaultLabel={writing.label} placeholder="e.g. Leg press at the gym" onSave={async (id, label) => { await linkActionTag(id, writing.action, fam.personId, label); }} />
      )}
      {selected && <ActionTagSheet tag={selected} title={what(selected)} onClose={() => setSelected(null)} onQr={(url) => { setQr({ url, name: what(selected) }); setSelected(null); }} />}
      <QrSheet url={qr?.url ?? null} medName={qr?.name ?? ''} onClose={() => setQr(null)} />
    </div>
  );
}

function ActionTagSheet({ tag, title, onClose, onQr }: { tag: Tag; title: string; onClose: () => void; onQr: (url: string) => void }) {
  const toast = useToast();
  const [label, setLabel] = useState(tag.label ?? '');
  const [changing, setChanging] = useState(false);
  return (
    <Sheet open onClose={onClose} title={tagName(tag)}>
      <div className="space-y-4">
        <p>Tapping it: <strong>{title}</strong></p>
        <div className="flex gap-2 items-end">
          <div className="flex-1"><TextInput label="Name" value={label} onChange={(e) => setLabel(e.target.value)} /></div>
          <Button variant="secondary" disabled={label === (tag.label ?? '')} onClick={async () => { await renameTag(tag.id, label); toast('Renamed'); onClose(); }}>Save</Button>
        </div>
        <TagTest tagId={tag.id} medName={title} />
        <Button variant="secondary" className="w-full" onClick={() => setChanging(true)}>Change what it does</Button>
        <Button variant="secondary" className="w-full" onClick={() => onQr(tagUrl(tag.id))}>Print QR sticker</Button>
        <Button variant="danger" className="w-full" onClick={async () => { await unlinkTag(tag.id); toast(`Unlinked ${tagName(tag)}`, { onAction: () => restoreTag(tag) }); onClose(); }}>Unlink this tag</Button>
        <p className="text-sm text-muted">Unlinking doesn't erase the tag. Tapping it afterwards shows “New tag found”.</p>
      </div>
      {changing && (
        <Sheet open onClose={() => setChanging(false)} title="What should the tag do?">
          <ActionPicker onPicked={async (action) => {
            const before = tag;
            await linkActionTag(tag.id, action, tag.personId ?? DEFAULT_PERSON, tag.label);
            toast('Tag changed', { onAction: () => restoreTag(before) });
            setChanging(false); onClose();
          }} />
        </Sheet>
      )}
    </Sheet>
  );
}
