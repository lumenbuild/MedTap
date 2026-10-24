// Choosing what a non-medication tag does: an exercise, a routine, water, protein, cardio, scales, a tape measure, a
// food, blood pressure or a check-in. Used when a new tag is tapped and from the Tags screen.
import { useState } from 'react';
import type { CardioActivity, TagAction } from '../../db/schema';
import { useExercises, useFamily, useRoutines, useSettings } from '../../app/data';
import { personOf } from '../../db/repos/people';
import { ACTION_KINDS } from '../../logic/tagActions';
import { db } from '../../db/db';
import { useLive } from '../../db/live';
import { HAS_BODY, HAS_TRAINING, HAS_FOOD, FOCUS } from '../../edition';
import { Sheet, SheetActions } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { TextInput } from '../../components/ui/Field';
import { ACTIVITIES, ExercisePicker } from '../Training/TrainingSheets';

/** The kinds this phone can use: training ones with the Training tab on, scales and tape measure only where weight is
 *  tracked, a food only with food logging on. The app's own main thing comes first. */
export function useActionKinds() {
  const settings = useSettings();
  const training = HAS_TRAINING && !!settings?.trainingTools;
  const food = HAS_FOOD && !!settings?.foodTracking;
  const kinds = ACTION_KINDS.filter((k) => (!k.training || training) && (!k.body || HAS_BODY) && (!k.food || food));
  return FOCUS === 'weight' ? [...kinds.filter((k) => k.body || k.food), ...kinds.filter((k) => !k.body && !k.food)] : kinds;
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
  const foods = (useLive(() => db.foods.toArray(), []) ?? []).filter((f) => !f.deletedAt).sort((a, b) => (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? ''));
  const pick = (k: TagAction['kind']) => {
    if (k === 'weight' || k === 'bp' || k === 'checkin' || k === 'measure') { onPicked({ kind: k } as TagAction, ACTION_KINDS.find((x) => x.kind === k)!.name); return; }
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
      {step === 'food' && (
        <Sheet open onClose={() => setStep(null)} title="Which food or drink?">
          {foods.length === 0 ? <p className="text-muted">Nothing saved yet. Log it once in Food (scan its barcode or photo the label), then link the tag.</p> : (
            <ul>
              {foods.map((f) => (
                <li key={f.id} className="border-t border-border">
                  <button type="button" className="w-full text-left py-3 min-h-[48px]" onClick={() => { setStep(null); onPicked({ kind: 'food', foodId: f.id }, f.name); }}>
                    <span className="block font-medium">{f.name}</span>
                    {f.serving && <span className="block text-sm text-muted">{f.serving}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Sheet>
      )}
      {(step === 'water' || step === 'protein') && (
        <Sheet open onClose={() => setStep(null)} title={step === 'water' ? 'Water bottle' : 'Protein shaker'}>
          <div className="space-y-4">
            <TextInput label={step === 'water' ? 'How much it holds (mL)' : 'Protein in each shake (g)'} type="number" inputMode="numeric" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <p className="text-sm text-muted">Added on each tap</p>
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
