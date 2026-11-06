// The Health tab (MedTap): everything the watch and Health Connect bring in, made useful. How recovered you are and
// what today suits, anything off overnight, last night's vitals against your usual, training load and fitness,
// calories in against out, activity, glucose, and what changed after starting each medicine.
import { Brain, Droplet, Flame, Footprints, Mountain } from 'lucide-react';
import type { DailyHealth, FoodLog } from '../db/schema';
import { useBodyEntries, useCheckIns, useDaily, useDoses, useFamily, useMeds, useScheduleSettings, useVitals, useWorkouts } from '../app/data';
import { apnoeaCheck, bodyClock, bpWithWeight, fitnessAge, rhrExplained, usualBands } from '../logic/healthChecks';
import { ApnoeaCard, BodyClockCard, BpWeightCard, FitnessAgeCard, RhrCard, UsualBandsCard } from '../components/HealthChecks';
import { useLive } from '../db/live';
import { db } from '../db/db';
import { useNow } from '../app/useNow';
import { medIsFor, personOf } from '../db/repos/people';
import { readiness } from '../logic/training';
import { illnessWatch, nightVitals } from '../logic/vitals';
import { daySuggestion, trainingLoad, vo2Trend } from '../logic/trainingLoad';
import { medEffects } from '../logic/medEffects';
import { energyBalance } from '../logic/energy';
import { dayKey } from '../logic/stats';
import { MiniRing } from '../components/ui/Visual';
import { fmtHM } from '../logic/sleep';
import type { ScheduleSettings } from '../logic/schedule';
import { WorkingLink } from '../components/Decisions';
import { SickCard } from '../components/TodayPlan';
import { TopicLinks } from '../components/TopicLinks';
import { HAS_BODY } from '../edition';
import { EnergyCard, GlucoseCard, IllnessCard, LoadCard, MedEffectsList, NightVitalsCard } from '../components/HealthCards';

const DAY = 86_400_000;
const n0 = (v: number) => Math.round(v).toLocaleString('en-AU');

function useMine() {
  const daily = useDaily(); const workouts = useWorkouts(); const fam = useFamily(); const ss = useScheduleSettings(); const checkIns = useCheckIns();
  const meds = useMeds(); const doses = useDoses(); const body = useBodyEntries(); const vitals = useVitals();
  const foodLogs = useLive(() => db.foodLogs.toArray(), []);
  if (!daily || !workouts || !fam || !ss || !checkIns || !meds || !doses || !foodLogs || !body || !vitals) return null;
  const person = fam.people.find((p) => p.id === fam.personId);
  const me = <T extends { personId?: string; deletedAt?: string }>(x: T) => personOf(x) === fam.personId && !x.deletedAt;
  const myMeds = meds.filter((m) => medIsFor(m, fam.personId) && !m.archived);
  return { daily: daily.filter(me), workouts: workouts.filter(me), checkIns: checkIns.filter(me), foodLogs: foodLogs.filter(me) as FoodLog[], meds: myMeds,
    doses: doses.filter((d) => !d.deletedAt && myMeds.some((m) => m.id === d.medicationId)), settings: ss[0], s: ss[1],
    body: body.filter(me), vitals: vitals.filter(me), personId: fam.personId,
    about: { heightCm: person?.heightCm, birthYear: person?.birthYear, sex: person?.sex }, goalKg: person?.goals?.find((g) => g.metric === 'weightKg')?.target };
}

export function Health() {
  const d = useMine();
  const now = useNow(300_000);
  if (!d) return <div className="h-60 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;
  const r = readiness(d.daily, d.checkIns, now, d.s);
  const ill = illnessWatch(d.daily, now, d.s);
  const hasSick = d.daily.filter((x) => !x.deletedAt && (typeof x.restingHr === 'number' || typeof x.skinTempDelta === 'number')).length >= 12;
  const load = trainingLoad(d.workouts, now);
  const suggestion = daySuggestion(r, load, ill);
  const vitals = nightVitals(d.daily, now, d.s);
  const energy = energyBalance(d.daily, d.foodLogs, now, d.s);
  const vo2 = vo2Trend(d.daily, now);
  const effects = d.meds.map((m) => ({ m, e: medEffects(m, d.doses, d.daily, now) })).filter((x) => x.e && x.e.effects.length);
  const nothing = !r && !vitals && !load && !energy && !vo2;
  // Cross-checks with the scale, blood pressure, medicines and check-ins.
  const bands = usualBands({ daily: d.daily, body: d.body, vitals: d.vitals }, now);
  const osa = apnoeaCheck({ daily: d.daily, body: d.body, vitals: d.vitals, checkIns: d.checkIns, meds: d.meds, about: d.about }, now);
  const bp = bpWithWeight({ vitals: d.vitals, body: d.body, checkIns: d.checkIns, meds: d.meds }, now);
  const fit = fitnessAge(d.daily, d.body, d.about, d.goalKg, now);
  const hours = (t: number) => d.workouts.filter((w) => { const s = Date.parse(w.startedAt); return s <= t && s > t - 7 * DAY; })
    .reduce((a, w) => a + (w.cardio?.durationMin ?? (w.endedAt ? (Date.parse(w.endedAt) - Date.parse(w.startedAt)) / 60_000 : 45)), 0) / 60;
  const rhr = rhrExplained({ daily: d.daily, body: d.body, doses: d.doses, meds: d.meds, workoutsPerWeek: d.workouts.length ? hours : undefined }, now);
  const clock = bodyClock(d.daily, d.checkIns, now);
  const need = (...k: ('height' | 'birthYear' | 'sex')[]) => k.filter((x) => (x === 'height' ? !d.about.heightCm : x === 'birthYear' ? !d.about.birthYear : !d.about.sex));
  return (
    <div className="space-y-3 pb-8">
      {nothing && (
        <section className="box space-y-2">
          <h2 className="text-sm font-medium text-muted">Nothing from your watch yet</h2>
          <p>Turn on Health data in Settings and allow it in Health Connect: sleep, heart rate, HRV, blood oxygen, breathing, temperature, workouts and more come in when you open the app.</p>
          <a href="#/settings/health" className="inline-flex min-h-[44px] items-center font-medium underline underline-offset-4">Health data settings</a>
        </section>
      )}
      {r && (
        <section className="hero body" aria-label={`Readiness ${r.score} of 100: ${r.label}`}>
          <p className="hero-label">Readiness today</p>
          <div className="mt-2 flex items-center gap-4">
            <MiniRing value={r.score} max={100} size={88} label={`${r.score} of 100`}><span className="text-[28px] font-bold tnum">{r.score}</span></MiniRing>
            <div className="min-w-0">
              <p className="text-[30px] leading-9 font-bold tracking-[-0.02em]">{r.label}</p>
              {suggestion && <p className="text-[17px] font-semibold">{suggestion.title}</p>}
              {suggestion && <p className="text-muted text-[15px]">{suggestion.why}</p>}
            </div>
          </div>
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {r.parts.map((p) => <li key={p.what} className="text-[13px] rounded-full px-2.5 py-1 bg-surface"><span aria-hidden="true">{p.good ? '● ' : '▲ '}</span>{p.what}: {p.text}</li>)}
          </ul>
        </section>
      )}
      {/* Getting sick: learned from your own nights and past illnesses (the simpler watch when there isn't enough yet). */}
      <SickCard />
      <TopicLinks body={HAS_BODY} />
      {ill && !hasSick && <IllnessCard ill={ill} />}
      <WorkingLink />
      {/* Last night's vitals live in "Against your usual" once there's enough history for a range. */}
      {vitals && !bands.some((b) => ['hrvMs', 'restingHr', 'spo2Avg', 'respRate', 'skinTempDelta'].includes(b.key)) && <NightVitalsCard stats={vitals.stats} />}
      <UsualBandsCard bands={bands} />
      {bp && <BpWeightCard b={bp} />}
      {osa && <ApnoeaCard a={osa} personId={d.personId} need={need('height', 'birthYear', 'sex')} />}
      {fit && <FitnessAgeCard f={fit} personId={d.personId} need={need('birthYear', 'sex')} />}
      {rhr && rhr.parts.length > 0 && <RhrCard r={rhr} />}
      {clock && <BodyClockCard c={clock} />}
      {(load || vo2) && <LoadCard load={load} vo2={vo2} />}
      {energy && <EnergyCard e={energy} />}
      <ActivityCard daily={d.daily} now={now} s={d.s} />
      <GlucoseCard daily={d.daily} now={now} />
      {effects.length > 0 && (
        <section className="box space-y-3" aria-labelledby="fx-h">
          <h2 id="fx-h" className="text-sm font-medium text-muted">Since starting each medicine</h2>
          {effects.map(({ m, e }) => <MedEffectsList key={m.id} med={m} e={e!} link />)}
          <p className="text-sm text-muted">The 4 weeks before the first dose against the latest 4 weeks. Other things change over the same time too.</p>
        </section>
      )}
    </div>
  );
}

function ActivityCard({ daily, now, s }: { daily: DailyHealth[]; now: number; s: ScheduleSettings }) {
  const today = daily.find((d) => d.date === dayKey(now, s));
  const week = daily.filter((d) => new Date(`${d.date}T12:00`).getTime() > now - 7 * DAY);
  const mindful = week.reduce((a, d) => a + (d.mindfulMin ?? 0), 0);
  const water = today ? (today.waterMl ?? 0) + (today.waterOtherMl ?? 0) : 0;
  const tiles = [
    today?.steps !== undefined && { Icon: Footprints, label: 'Steps', value: n0(today.steps), tone: 'act' },
    today?.kcalActive !== undefined && { Icon: Flame, label: 'Active calories', value: n0(today.kcalActive), tone: 'act' },
    today?.floors !== undefined && { Icon: Mountain, label: 'Floors', value: String(today.floors), tone: 'act' },
    water > 0 && { Icon: Droplet, label: 'Water', value: `${n0(water)} mL`, tone: 'body' },
    mindful > 0 && { Icon: Brain, label: 'Mindful, 7 days', value: mindful < 60 ? `${mindful} min` : fmtHM(mindful), tone: 'mind' },
  ].filter(Boolean) as { Icon: typeof Flame; label: string; value: string; tone: string }[];
  if (!tiles.length) return null;
  return (
    <section className="box" aria-labelledby="act-h">
      <h2 id="act-h" className="text-sm font-medium text-muted mb-2">Today</h2>
      <div className="grid grid-cols-2 gap-2">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-card bg-surface-2 p-3">
            <p className="text-[13px] text-muted font-medium flex items-center gap-1.5"><span aria-hidden="true" className="w-[22px] h-[22px] rounded-[7px] flex items-center justify-center text-white" style={{ background: `var(--c-${t.tone})` }}><t.Icon size={13} /></span>{t.label}</p>
            <p className="mt-1.5 text-[22px] font-bold tnum leading-none">{t.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

