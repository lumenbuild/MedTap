import { useState } from 'react';
import { shownName } from '../../logic/privacy';
import { ChevronRight, Eraser, Nfc, Plus } from 'lucide-react';
import type { Medication, Tag } from '../../db/schema';
import { useTags } from '../../app/data';
import { useNow } from '../../app/useNow';
import { useToast } from '../../app/toast';
import { renameTag, restoreTag, unlinkTag } from '../../db/repos/tags';
import { tagUrl } from '../../nfc/url';
import { fmtAgo } from '../../logic/format';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Sheet } from '../../components/ui/Sheet';
import { TextInput } from '../../components/ui/Field';
import { LinkTagSheet } from './LinkTagSheet';
import { QrSheet } from './QrSheet';
import { TagTest } from './TagTest';
import { EraseTagSheet } from '../Tags/EraseTagSheet';

export const tagName = (t: Tag) => t.label || `Tag ${t.id.slice(0, 4).toUpperCase()}`;

export function TagsSection({ med }: { med: Medication }) {
  const tags = useTags()?.filter((t) => t.medicationId === med.id) ?? [];
  const now = useNow(60_000);
  const toast = useToast();
  const [linking, setLinking] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Tag | null>(null);
  const [label, setLabel] = useState('');
  const [erasing, setErasing] = useState<Tag | null>(null);

  const unlink = async (t: Tag) => {
    await unlinkTag(t.id);
    setSelected(null);
    toast(`Unlinked ${tagName(t)}`, { onAction: () => restoreTag(t) });
  };

  return (
    <Card>
      <h2 className="text-sm font-medium text-muted">Tags</h2>
      {tags.length === 0 ? (
        <p className="text-muted mt-1">Tap to log</p>
      ) : (
        <ul className="mt-2 -mx-2">
          {tags.map((t) => (
            <li key={t.id}>
              <button onClick={() => { setSelected(t); setLabel(t.label ?? ''); }} className="w-full min-h-[56px] flex items-center gap-3 px-2 rounded-btn text-left hover:bg-surface-2">
                <Nfc className="text-primary shrink-0" aria-hidden="true" />
                <span className="flex-1">
                  <span className="block font-medium">{tagName(t)}</span>
                  <span className="block text-sm text-muted">{t.lastScannedAt ? `Last tapped ${fmtAgo(now - Date.parse(t.lastScannedAt))}` : 'Not tapped yet'}</span>
                </span>
                <ChevronRight size={18} className="text-muted" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button variant={tags.length ? 'secondary' : 'primary'} className="w-full mt-3 flex items-center justify-center gap-2" onClick={() => setLinking(true)}>
        <Plus size={20} aria-hidden="true" /> Link {tags.length ? 'another' : 'a'} tag
      </Button>

      <LinkTagSheet med={med} open={linking} onClose={() => setLinking(false)} onQr={setQr} />
      <QrSheet url={qr} medName={shownName(med)} onClose={() => setQr(null)} />
      <EraseTagSheet open={!!erasing} onClose={() => setErasing(null)} tag={erasing ?? undefined} name={shownName(med)} />

      <Sheet open={!!selected} onClose={() => setSelected(null)} title={selected ? tagName(selected) : ''}>
        {selected && (
          <div className="space-y-4">
            <div className="flex gap-2 items-end">
              <div className="flex-1"><TextInput label="Name" placeholder="e.g. Bottle at work" value={label} onChange={(e) => setLabel(e.target.value)} /></div>
              <Button variant="secondary" disabled={label === (selected.label ?? '')}
                onClick={async () => { await renameTag(selected.id, label); toast('Renamed'); setSelected(null); }}>Save</Button>
            </div>
            <TagTest tagId={selected.id} medName={shownName(med)} />
            <Button variant="secondary" className="w-full" onClick={() => { setQr(tagUrl(selected.id)); setSelected(null); }}>Print QR sticker</Button>
            <Button variant="secondary" className="w-full flex items-center justify-center gap-2" onClick={() => { setErasing(selected); setSelected(null); }}><Eraser size={18} aria-hidden="true" /> Erase this tag to reuse it</Button>
            <Button variant="danger" className="w-full" onClick={() => unlink(selected)}>Unlink this tag</Button>
          </div>
        )}
      </Sheet>
    </Card>
  );
}
