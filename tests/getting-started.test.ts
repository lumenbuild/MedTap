import { describe, it, expect } from 'vitest';
import type { CheckIn, Dose, Medication, Tag } from '../src/db/schema';
import { gettingStarted, showGettingStarted } from '../src/logic/gettingStarted';

const st = { createdAt: '', updatedAt: '' };
const med = { id: 'm', name: 'Vyvanse', archived: false, ...st } as Medication;
const base = { meds: [] as Medication[], tags: [] as Tag[], doses: [] as Dose[], checkIns: [] as CheckIn[], remindersEnabled: false, lockEnabled: false, lastBackupAt: null as string | null, native: true };

describe('getting started', () => {
  it('ticks each step from the records', () => {
    const empty = gettingStarted(base);
    expect(empty.map((i) => i.id)).toEqual(['med', 'tag', 'dose', 'checkin', 'reminders', 'lock', 'backup']);
    expect(empty.every((i) => !i.done)).toBe(true);
    const some = gettingStarted({ ...base, meds: [med], tags: [{ id: 't', medicationId: 'm', createdAt: '' } as Tag], lockEnabled: true });
    expect(some.filter((i) => i.done).map((i) => i.id)).toEqual(['med', 'tag', 'lock']);
    // A tag for a medicine that's gone doesn't count.
    expect(gettingStarted({ ...base, meds: [med], tags: [{ id: 't', medicationId: 'x', createdAt: '' } as Tag] }).find((i) => i.id === 'tag')!.done).toBe(false);
  });
  it('shows until the essentials are done or it is hidden; reminders only in the app', () => {
    const all = gettingStarted({ ...base, meds: [med], tags: [{ id: 't', medicationId: 'm', createdAt: '' } as Tag], doses: [{ id: 'd' } as Dose], checkIns: [{ id: 'c' } as CheckIn] });
    expect(showGettingStarted(all, false)).toBe(false); // optional steps don't keep it there
    expect(showGettingStarted(gettingStarted(base), false)).toBe(true);
    expect(showGettingStarted(gettingStarted(base), true)).toBe(false);
    expect(gettingStarted({ ...base, native: false }).some((i) => i.id === 'reminders')).toBe(false);
  });
});

describe('getting started in TapWeigh and TapLift', () => {
  const empty = { meds: [], tags: [], doses: [], checkIns: [], remindersEnabled: false, lockEnabled: false, lastBackupAt: null, native: true };
  it('starts with a tag on the scales and a weigh-in', () => {
    const items = gettingStarted({ ...empty, focus: 'weight', weighIns: 0 });
    expect(items.filter((i) => i.essential).map((i) => i.id)).toEqual(['tag', 'weigh']);
    const done = gettingStarted({ ...empty, focus: 'weight', weighIns: 3, tags: [{ id: 't', medicationId: '', action: { kind: 'weight' }, createdAt: '' } as Tag] });
    expect(showGettingStarted(done, false)).toBe(false);
  });
  it('starts with a gym tag and a workout, and never mentions medicines', () => {
    const items = gettingStarted({ ...empty, focus: 'training', workouts: 0 });
    expect(items.map((i) => i.id)).not.toContain('med');
    expect(items.find((i) => i.id === 'tag')!.done).toBe(false);
    const tagged = gettingStarted({ ...empty, focus: 'training', workouts: 1, tags: [{ id: 't', medicationId: '', action: { kind: 'exercise', exerciseId: 'bench' }, createdAt: '' } as Tag] });
    expect(showGettingStarted(tagged, false)).toBe(false);
  });
});
