import { ChevronRight, Nfc, Plus } from 'lucide-react';
import type { Medication, Tag } from '../../db/schema';
import { useMeds, useSettings, useTags } from '../../app/data';
import { go } from '../../app/router';
import { fmtMedName, fmtSchedule } from '../../logic/format';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { MedBadge } from '../../components/MedBadge';

export function MedsList() {
  const meds = useMeds();
  const tags = useTags();
  const settings = useSettings();
  if (!meds || !tags || !settings) return <div className="h-40 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;

  const active = meds.filter((m) => !m.archived);
  const archived = meds.filter((m) => m.archived);

  return (
    <div className="space-y-4">
      {settings.pendingTags.map((id) => (
        <Card key={id} className="flex items-center gap-3">
          <Nfc className="text-primary shrink-0" aria-hidden="true" />
          <p className="flex-1">A tag you tapped isn't linked yet.</p>
          <Button variant="secondary" onClick={() => go(`/tag/${id}`)}>Link</Button>
        </Card>
      ))}

      {active.length === 0 ? (
        <Card className="text-center py-8">
          <p>No medications yet. Adding one takes about a minute.</p>
        </Card>
      ) : (
        <ul className="space-y-2">{active.map((m) => <MedRow key={m.id} med={m} tags={tags} />)}</ul>
      )}

      <Button className="w-full min-h-[56px] flex items-center justify-center gap-2" onClick={() => go('/meds/new')}>
        <Plus size={20} aria-hidden="true" /> Add medication
      </Button>

      {archived.length > 0 && (
        <details className="pt-2">
          <summary className="min-h-[48px] flex items-center text-muted font-semibold cursor-pointer">Archived ({archived.length})</summary>
          <ul className="space-y-2 opacity-80">{archived.map((m) => <MedRow key={m.id} med={m} tags={tags} />)}</ul>
        </details>
      )}
    </div>
  );
}

function MedRow({ med, tags }: { med: Medication; tags: Tag[] }) {
  const n = tags.filter((t) => t.medicationId === med.id).length;
  const low = med.stockCount !== undefined && med.lowStockAt !== undefined && med.stockCount <= med.lowStockAt;
  return (
    <li>
      <a href={`#/meds/${med.id}`} className="bg-surface rounded-card shadow-card p-4 flex items-center gap-3">
        <MedBadge color={med.color} icon={med.icon} />
        <span className="flex-1 min-w-0">
          <span className="block font-semibold truncate">{fmtMedName(med)}</span>
          <span className="block text-sm text-muted">{fmtSchedule(med.schedule)}</span>
          <span className="block text-sm text-muted tnum">
            {n === 0 ? 'No tag yet' : `${n} tag${n === 1 ? '' : 's'} linked`}
            {med.stockCount !== undefined && <> · <span className={low ? 'text-caution font-medium' : ''}>{med.stockCount} left</span></>}
          </span>
        </span>
        <ChevronRight className="text-muted" aria-hidden="true" />
      </a>
    </li>
  );
}
