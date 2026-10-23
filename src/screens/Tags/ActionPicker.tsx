// Choosing what a non-medication tag does: an exercise, a routine, water, protein, cardio, scales, blood pressure or a
// check-in. Used when a new tag is tapped and from the Tags screen.
import { useState } from 'react';
import type { CardioActivity, TagAction } from '../../db/schema';
import { useExercises, useFamily, useRoutines, useSettings } from '../../app/data';
import { personOf } from '../../db/repos/people';
import { ACTION_KINDS } from '../../logic/tagActions';
import { HAS_BODY } from '../../edition';
import { Sheet, SheetActions } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { TextInput } from '../../components/ui/Field';
import { ACTIVITIES, ExercisePicker } from '../Training/TrainingSheets';

/** The kinds this phone can use: training ones with the Training tab on, scales only where weight is tracked. */
export function useActionKinds() {
  const settings = useSettings();
  const training = HAS_BODY && !!settings?.trainingTools;
  return ACTION_KINDS.filter((k) => (!k.training || training) && (!k.body || HAS_BODY));
}

/** A list of the kinds; choosing one asks for what it needs (which exercise, how much water) and then calls `onPicked`
 *  with the action and a suggested name for the tag. */
export function ActionPicker({ onPicked }: { onPicked: (a: TagAction, label: string) => void }) {
  const kinds = useActionKinds();
  const own = useExercises() ?? [];
  const routines = useRoutines() ?? [];
  const fam = useFamily();
  const [step, setStep] = useState<TagAction['kind'] | null>(null);
  const [amount, setAmount] = useState('');
  const mine = routines.filter((r) => !r.deletedAt && personOf(r) === fam?.personId);
  const pick = (k: TagAction['kind']) => {
    if (k === 'weight' || k === 'bp' || k === 'checkin') { onPicked({ kind: k } as TagAction, ACTION_KINDS.find((x) => x.kind === k)!.name); return; }
    setAmount(k === 'water' ? '500' : k === 'protein' ? '25' : '');
    setStep(k);
  };
  return (
    <>
      <ul>
        {kinds.map((k) => (
          <li key={k.kind}>
            <button type="button" onClick={() => pick(k.kind)} className="w-full min-h-[56px] flex flex-col justify-center px-3 rounded-btn bg-surface-2 text-left mb-2">
              <span className="font-medium">{k.name}</span>
              <span className="text-sm text-muted">{k.where}</span>
            </button>
          </li>
        ))}
      </ul>
      {step === 'exercise' && fam && <ExercisePicker title="Which exercise?" own={own} personId={fam.personId} onClose={() => setStep(null)} onPick={(d) => onPicked({ kind: 'exercise', exerciseId: d.id }, d.name)} />}
      {step === 'routine' && (
        <Sheet open onClose={() => setStep(null)} title="Which routine?">
          {mine.length === 0 ? <p className="text-muted">No routines yet. Make one in Training → Routines, then link the tag.</p> : (
            <ul>
              {mine.map((r) => (
                <li key={r.id} className="border-t border-border">
                  <button type="button" className="w-full text-left py-3 min-h-[48px] font-medium" onClick={() => { setStep(null); onPicked({ kind: 'routine', routineId: r.id }, r.name); }}>{r.name}</button>
                </li>
              ))}
            </ul>
          )}
        </Sheet>
      )}
      {step === 'cardio' && (
        <Sheet open onClose={() => setStep(null)} title="Which activity?">
          <ul>
            {ACTIVITIES.map((a) => (
              <li key={a.id} className="border-t border-border">
                <button type="button" className="w-full text-left py-3 min-h-[48px] font-medium" onClick={() => { setStep(null); onPicked({ kind: 'cardio', activity: a.id as CardioActivity }, a.name); }}>{a.name}</button>
              </li>
            ))}
          </ul>
        </Sheet>
      )}
      {(step === 'water' || step === 'protein') && (
        <Sheet open onClose={() => setStep(null)} title={step === 'water' ? 'Water bottle' : 'Protein shaker'}>
          <div className="space-y-4">
            <TextInput label={step === 'water' ? 'How much it holds (mL)' : 'Protein in each shake (g)'} type="number" inputMode="numeric" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <p className="text-sm text-muted">Each tap adds this much to today, with Undo. You can change it later by linking the tag again.</p>
            <SheetActions>
              <Button className="w-full min-h-[56px]" disabled={!(Number(amount) > 0)} onClick={() => {
                const n = Math.round(Number(amount)); setStep(null);
                onPicked(step === 'water' ? { kind: 'water', ml: n } : { kind: 'protein', g: n }, step === 'water' ? `Water bottle (${n} mL)` : `Protein shaker (${n} g)`);
              }}>Use this amount</Button>
            </SheetActions>
          </div>
        </Sheet>
      )}
    </>
  );
}
