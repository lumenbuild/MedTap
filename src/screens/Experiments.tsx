// Self-experiments (biohacking tools): pick a question (or a ready-made one), the app sets A and B in blocks of days
// in a random order, shows today's condition on Today, and reports the difference and how likely it's chance.
import { useState } from 'react';
import { format } from 'date-fns';
import { FlaskConical, Plus, Square, Trash2 } from 'lucide-react';
import type { Experiment } from '../db/schema';
import { db } from '../db/db';
import { personOf, storedPerson } from '../db/repos/people';
import { useBodyEntries, useCheckIns, useDaily, useExperiments, useFamily } from '../app/data';
import { useNow } from '../app/useNow';
import { useToast } from '../app/toast';
import { analyse, conditionOn, experimentFor, lastDay, METRICS, randomBlocks, TEMPLATES, type ExperimentResult } from '../logic/experiments';
import { guideById } from '../logic/peptideGuide';
import { Button } from '../components/ui/Button';
import { Select, TextInput } from '../components/ui/Field';
import { Sheet, SheetActions } from '../components/ui/Sheet';

const ymd = (t: number) => format(t, 'yyyy-MM-dd');

const VERDICT: Record<ExperimentResult['verdict'], (e: Experiment) => string> = {
  running: () => 'Still running', 'too-few': () => 'Finished, but too few days measured to say',
  'a-better': (e) => `${e.a} was better`, 'b-better': (e) => `${e.b} was better`,
  'leaning-a': (e) => `Leaning towards ${e.a}, not yet clear`, 'leaning-b': (e) => `Leaning towards ${e.b}, not yet clear`,
  'no-difference': () => 'No clear difference',
};

export function Experiments({ guideId }: { guideId?: string } = {}) {
  const list = useExperiments(); const checkIns = useCheckIns(); const daily = useDaily(); const body = useBodyEntries(); const fam = useFamily();
  const now = useNow(600_000);
  const toast = useToast();
  const fromGuide = guideId ? guideById(guideId) : undefined;
  const preset = fromGuide ? experimentFor(fromGuide) ?? undefined : undefined;
  const [sheet, setSheet] = useState(!!preset);
  if (!list || !checkIns || !daily || !body || !fam) return <div className="h-60 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;
  const me = <T extends { personId?: string }>(x: T) => personOf(x) === fam.personId;
  const mine = list.filter((e) => me(e) && !e.deletedAt).sort((a, b) => b.start.localeCompare(a.start));
  const data = { checkIns: checkIns.filter(me), daily: daily.filter(me), body: body.filter(me) };
  const today = ymd(now);
  return (
    <div className="space-y-5 pb-8">
      <p className="text-muted leading-snug">Test one thing at a time: A and B in blocks of days in a random order, measured the same way. The order stops a good or bad week from deciding it.</p>
      <Button className="w-full min-h-[52px]" onClick={() => setSheet(true)}><Plus size={18} aria-hidden="true" className="inline mr-1.5 -mt-0.5" />New experiment</Button>
      {mine.map((e) => {
        const c = conditionOn(e, today);
        const r = analyse(e, data, now);
        const m = METRICS[e.metric];
        const over = today > (e.ended ?? lastDay(e));
        return (
          <section key={e.id} aria-labelledby={`ex-${e.id}`} className="box space-y-2">
            <h2 id={`ex-${e.id}`} className="font-semibold flex items-center gap-2"><FlaskConical size={18} aria-hidden="true" className="text-primary" />{e.title}</h2>
            {c && !over && <p className="leading-snug">Today: <strong>{c.arm === 'a' ? e.a : e.b}</strong> <span className="text-muted">(day {c.dayInBlock} of {e.blockDays}, block {c.block + 1} of {e.blocks.length})</span></p>}
            <div className="flex gap-1" role="img" aria-label={`Blocks: ${e.blocks.map((b) => (b === 'a' ? e.a : e.b)).join(', ')}`}>
              {e.blocks.map((b, i) => <div key={i} className="flex-1 h-2.5 rounded-full" style={{ background: b === 'a' ? 'var(--primary)' : 'var(--border-strong)', opacity: i < r.progress.blocksDone ? 1 : 0.35 }} />)}
            </div>
            <p className="text-[12px] text-muted"><span className="inline-block w-2.5 h-2.5 rounded-full align-middle mr-1" style={{ background: 'var(--primary)' }} />{e.a} <span className="inline-block w-2.5 h-2.5 rounded-full align-middle ml-3 mr-1" style={{ background: 'var(--border-strong)' }} />{e.b} · measured by {m.label.toLowerCase()}</p>
            <dl className="grid grid-cols-2 gap-2 tnum">
              <div className="rounded-card bg-surface-2 p-3"><dt className="text-[12px] text-muted">{e.a}</dt><dd className="text-[20px] font-semibold">{r.a.mean ?? '–'}{m.unit && r.a.mean !== undefined ? ` ${m.unit}` : ''}</dd><dd className="text-[12px] text-muted">{r.a.days} days</dd></div>
              <div className="rounded-card bg-surface-2 p-3"><dt className="text-[12px] text-muted">{e.b}</dt><dd className="text-[20px] font-semibold">{r.b.mean ?? '–'}{m.unit && r.b.mean !== undefined ? ` ${m.unit}` : ''}</dd><dd className="text-[12px] text-muted">{r.b.days} days</dd></div>
            </dl>
            <p className="leading-snug"><span className="font-medium">{VERDICT[r.verdict](e)}</span>{r.p !== undefined ? <span className="text-muted"> · {Math.round(r.p * 100)}% chance a difference this big is luck{r.effect !== undefined ? ` · effect size ${Math.abs(r.effect)}` : ''}</span> : ''}</p>
            <div className="flex gap-2">
              {!over && !e.ended && <button type="button" className="min-h-[44px] text-sm flex items-center gap-1.5" onClick={async () => { await db.experiments.update(e.id, { ended: today, updatedAt: new Date().toISOString() }); toast('Experiment ended'); }}><Square size={16} aria-hidden="true" />End now</button>}
              <button type="button" className="min-h-[44px] text-sm flex items-center gap-1.5 text-muted ml-auto" onClick={async () => { const t = new Date().toISOString(); await db.experiments.update(e.id, { deletedAt: t, updatedAt: t }); toast('Experiment deleted', { onAction: () => db.experiments.update(e.id, { deletedAt: undefined, updatedAt: new Date().toISOString() }) }); }}><Trash2 size={16} aria-hidden="true" />Delete</button>
            </div>
          </section>
        );
      })}
      {!mine.length && <p className="text-muted">No experiments yet.</p>}
      {sheet && <NewExperiment personId={fam.personId} preset={preset} onClose={() => setSheet(false)} />}
    </div>
  );
}

function NewExperiment({ personId, preset, onClose }: { personId: string; preset?: (typeof TEMPLATES)[number]; onClose: () => void }) {
  const toast = useToast();
  const options = preset ? [preset, ...TEMPLATES] : TEMPLATES;
  const [t, setT] = useState(0);
  const tpl = options[t];
  const [title, setTitle] = useState(tpl.title), [a, setA] = useState(tpl.a), [b, setB] = useState(tpl.b);
  const [metric, setMetric] = useState<Experiment['metric']>(tpl.metric);
  const [blockDays, setBlockDays] = useState(String(tpl.blockDays)), [blocks, setBlocks] = useState('8');
  const pick = (i: number) => { const x = options[i]; setT(i); setTitle(x.title); setA(x.a); setB(x.b); setMetric(x.metric); setBlockDays(String(x.blockDays)); };
  const days = Number(blockDays) * Number(blocks);
  return (
    <Sheet open onClose={onClose} title="New experiment">
      <div className="space-y-3">
        <Select label="Start from" value={String(t)} onChange={(e) => pick(Number(e.target.value))}>{options.map((x, i) => <option key={x.title} value={i}>{x.title}</option>)}</Select>
        <TextInput label="Name" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <TextInput label="A" value={a} onChange={(e) => setA(e.target.value)} />
          <TextInput label="B" value={b} onChange={(e) => setB(e.target.value)} />
        </div>
        <Select label="Measured by" value={metric} onChange={(e) => setMetric(e.target.value as Experiment['metric'])}>{Object.entries(METRICS).map(([k, m]) => <option key={k} value={k}>{m.label}{m.night ? ' (watch)' : ''}</option>)}</Select>
        <div className="grid grid-cols-2 gap-3">
          <Select label="Days in a block" value={blockDays} onChange={(e) => setBlockDays(e.target.value)}>{['1', '2', '3', '5', '7'].map((x) => <option key={x}>{x}</option>)}</Select>
          <Select label="Blocks" value={blocks} onChange={(e) => setBlocks(e.target.value)}>{['4', '6', '8', '10'].map((x) => <option key={x}>{x}</option>)}</Select>
        </div>
        <p className="text-sm text-muted">{days} days, starting today. Effects that carry over (like sleep from a supplement) suit longer blocks.</p>
      </div>
      <SheetActions>
        <Button className="w-full min-h-[52px]" disabled={!title.trim() || !a.trim() || !b.trim()} onClick={async () => {
          const at = new Date().toISOString();
          await db.experiments.add({ id: crypto.randomUUID(), title: title.trim(), a: a.trim(), b: b.trim(), metric, blockDays: Number(blockDays), blocks: randomBlocks(Number(blocks)), start: ymd(Date.now()), personId: storedPerson(personId), createdAt: at, updatedAt: at });
          toast('Experiment started: today’s condition is on Today'); onClose();
        }}>Start</Button>
      </SheetActions>
    </Sheet>
  );
}
