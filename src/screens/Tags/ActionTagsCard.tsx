// The tags linked to one exercise or routine, with a button to link another (e.g. a sticker on the leg press).
import { useState } from 'react';
import { Nfc, Plus } from 'lucide-react';
import type { TagAction } from '../../db/schema';
import { useFamily, useTags } from '../../app/data';
import { linkActionTag, restoreTag, unlinkTag } from '../../db/repos/tags';
import { useToast } from '../../app/toast';
import { Button } from '../../components/ui/Button';
import { WriteTagSheet } from '../Meds/LinkTagSheet';
import { QrSheet } from '../Meds/QrSheet';
import { tagName } from '../Meds/TagsSection';

const same = (a: TagAction, b: TagAction) => JSON.stringify(a) === JSON.stringify(b);

export function ActionTagsCard({ action, name, hint }: { action: TagAction; name: string; hint: string }) {
  const tags = (useTags() ?? []).filter((t) => t.action && same(t.action, action));
  const fam = useFamily();
  const toast = useToast();
  const [writing, setWriting] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  return (
    <section className="box" aria-labelledby="tg-h">
      <h2 id="tg-h" className="text-sm font-medium text-muted mb-1">Tags</h2>
      {tags.length === 0 ? <p className="text-[15px] text-muted">{hint}</p> : (
        <ul>
          {tags.map((t) => (
            <li key={t.id} className="flex items-center gap-3 min-h-[48px]">
              <Nfc size={18} className="text-primary shrink-0" aria-hidden="true" />
              <span className="flex-1">{tagName(t)}</span>
              <button type="button" className="text-sm underline min-h-[44px] px-2" onClick={async () => { await unlinkTag(t.id); toast(`Unlinked ${tagName(t)}`, { onAction: () => restoreTag(t) }); }}>Unlink</button>
            </li>
          ))}
        </ul>
      )}
      <Button variant="secondary" className="w-full mt-2 flex items-center justify-center gap-2" onClick={() => setWriting(true)}><Plus size={18} aria-hidden="true" /> Link {tags.length ? 'another' : 'a'} tag</Button>
      {writing && fam && (
        <WriteTagSheet open onClose={() => setWriting(false)} onQr={setQr} name={name} title={`Link a tag to ${name}`} defaultLabel={name} placeholder="e.g. Leg press at the gym"
          onSave={async (id, label) => { await linkActionTag(id, action, fam.personId, label); toast(`Tag linked to ${name}`); }} />
      )}
      <QrSheet url={qr} medName={name} onClose={() => setQr(null)} />
    </section>
  );
}
