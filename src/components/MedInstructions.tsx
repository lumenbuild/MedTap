import { ClipboardList } from 'lucide-react';
import { format } from 'date-fns';
import type { Medication } from '../db/schema';

/** The medication's own instructions (from the person, a carer, pharmacist or doctor), shown wherever a dose is logged. */
export function MedInstructions({ med, className = '' }: { med: Medication; className?: string }) {
  if (!med.instructions?.trim()) return null;
  const meta = [med.instructionsBy?.trim() && `From ${med.instructionsBy.trim()}`,
    med.instructionsUpdatedAt && `updated ${format(Date.parse(med.instructionsUpdatedAt), 'd MMM yyyy')}`].filter(Boolean).join(' · ');
  return (
    <section aria-label="Instructions" className={`rounded-btn bg-primary-soft p-4 ${className}`}>
      <h2 className="flex items-center gap-2 text-sm font-semibold text-primary"><ClipboardList size={18} aria-hidden="true" /> Instructions</h2>
      <p className="mt-1.5 whitespace-pre-line break-words">{med.instructions.trim()}</p>
      {meta && <p className="mt-2 text-xs text-muted">{meta}</p>}
    </section>
  );
}
