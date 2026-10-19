import { Archive } from 'lucide-react';
import type { Medication } from '../../db/schema';
import { setArchived } from '../../db/repos/meds';
import { replace } from '../../app/router';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';

export function ArchivedTag({ med, onReassign }: { med: Medication; onReassign: () => void }) {
  return (
    <Card>
      <Archive className="text-muted" size={32} aria-hidden="true" />
      <h1 className="text-2xl font-semibold mt-3">{med.name} is archived</h1>
      <p className="text-muted mt-1">This tag is linked to {med.name}, which you archived. Restore it to log a dose, or use the tag for something else.</p>
      <div className="mt-5 space-y-3">
        <Button className="w-full min-h-[56px]" onClick={() => setArchived(med.id, false)}>Restore {med.name}</Button>
        <Button variant="secondary" className="w-full" onClick={onReassign}>Link to a different medication</Button>
        <Button variant="secondary" className="w-full" onClick={() => replace('/today')}>Go to Today</Button>
      </div>
    </Card>
  );
}
