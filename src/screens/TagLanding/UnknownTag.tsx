import { Nfc, Plus } from 'lucide-react';
import { shownColour, shownMedName, shownName } from '../../logic/privacy';
import type { Medication } from '../../db/schema';
import { linkTag } from '../../db/repos/tags';
import { addPendingTag } from '../../db/repos/settings';
import { go, replace } from '../../app/router';
import { useToast } from '../../app/toast';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { MedBadge } from '../../components/MedBadge';

/** "New tag found": assign to an existing medication (one tap), create one, or leave it for later. */
export function UnknownTag({ id, meds, relinking, onLinked, personName }: {
  id: string; meds: Medication[]; relinking: boolean; onLinked: () => void; personName?: (m: Medication) => string;
}) {
  const toast = useToast();
  const assign = async (m: Medication) => {
    await linkTag(id, m.id);
    toast(`Tag linked to ${shownName(m)}`);
    onLinked();
  };
  const notNow = async () => {
    await addPendingTag(id);
    replace('/today');
  };

  return (
    <Card>
      <Nfc className="text-primary" size={32} aria-hidden="true" />
      <h1 className="text-2xl font-semibold mt-3">{relinking ? 'Link this tag to…' : 'New tag found'}</h1>
      {!relinking && <p className="text-muted mt-1">This tag isn't linked to a medication on this phone yet.</p>}

      {meds.length > 0 && (
        <>
          <h2 className="text-sm font-semibold text-muted mt-5 mb-2">Assign to a medication</h2>
          <ul className="space-y-2">
            {meds.map((m) => (
              <li key={m.id}>
                <button onClick={() => assign(m)} className="w-full min-h-[56px] flex items-center gap-3 px-3 rounded-btn bg-surface-2 text-left font-medium">
                  <MedBadge color={shownColour(m)} icon={m.icon} size={32} />
                  <span>{shownMedName(m)}{personName && <span className="block text-sm font-normal text-muted">For {personName(m)}</span>}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="mt-5 space-y-3">
        <Button variant={meds.length ? 'secondary' : 'primary'} className="w-full flex items-center justify-center gap-2" onClick={() => go(`/meds/new/tag/${id}`)}>
          <Plus size={20} aria-hidden="true" /> Create a new medication
        </Button>
        <Button variant="secondary" className="w-full" onClick={notNow}>Not now</Button>
      </div>
      <p className="text-sm text-muted mt-4">If this tag belongs to someone else's medication, choose Not now. Nothing is saved about it except the tag's code.</p>
    </Card>
  );
}
