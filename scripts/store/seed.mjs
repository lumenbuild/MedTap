// Sample data for the store screenshots (each app's own database). TapWeigh and TapLift: 12 weeks of weigh-ins with a goal, measurements, food,
// check-ins, steps and sleep, blood pressure and tags; TapLift adds workouts, routines, protein and water.
export async function seedFocus(page, base, edition) {
  await page.goto(base);
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.waitForTimeout(800);
  await page.evaluate(async (edition) => {
    const DAY = 86400000, now = Date.now(), iso = (t) => new Date(t).toISOString();
    const ymd = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const stamp = { createdAt: iso(now - 90 * DAY), updatedAt: iso(now) };
    const lift = edition === 'taplift';
    await new Promise((res, rej) => {
      const q = indexedDB.open(edition);
      q.onsuccess = () => {
        const db = q.result;
        const names = ['bodyEntries', 'checkIns', 'daily', 'vitals', 'settings', 'tags', 'people', 'foods', 'foodLogs', 'workouts', 'routines'].filter((n) => db.objectStoreNames.contains(n));
        const tx = db.transaction(names, 'readwrite');
        // Weight: 96.4 kg down about 0.5 kg a week with daily noise and a short plateau; lean and fat every 3 weeks.
        const be = tx.objectStore('bodyEntries');
        for (let i = 84; i >= 0; i--) {
          if (i % 7 === 3 && i > 10) continue;
          const trend = 96.4 - (84 - i) * (lift ? 0.035 : 0.07) + (i < 30 && i > 20 ? 0.6 : 0);
          const noise = Math.sin(i * 1.7) * 0.35;
          const e = { id: `w${i}`, date: ymd(now - i * DAY), weightKg: Math.round((trend + noise) * 10) / 10, ...stamp };
          if (i % 21 === 0) Object.assign(e, { bodyFatPct: Math.round((31 - (84 - i) * 0.05) * 10) / 10, leanKg: Math.round((lift ? 64 + (84 - i) * 0.02 : 63.5 - (84 - i) * 0.01) * 10) / 10 });
          if (i % 14 === 0) Object.assign(e, { waistCm: Math.round((104 - (84 - i) * 0.08) * 10) / 10, hipsCm: Math.round((110 - (84 - i) * 0.05) * 10) / 10 });
          be.put(e);
        }
        tx.objectStore('people').put({ id: 'me', name: 'Me', goals: [{ metric: 'weightKg', target: lift ? 88 : 85, start: 96.4, startDate: ymd(now - 84 * DAY) }, ...(lift ? [] : [{ metric: 'waistCm', target: 94, start: 104, startDate: ymd(now - 84 * DAY) }])],
          ...(lift ? { fitnessGoals: [{ id: 'g1', kind: 'sessions', perWeek: 3, setAt: iso(now - 60 * DAY) }, { id: 'g2', kind: 'lift', exerciseId: 'bench', targetKg: 90, reps: 1, setAt: iso(now - 60 * DAY) }] } : {}), ...stamp });
        // Check-ins in the evening, steps, sleep and heart rate.
        const ci = tx.objectStore('checkIns'), dy = tx.objectStore('daily');
        for (let i = 60; i >= 1; i--) {
          const t = new Date(now - i * DAY); t.setHours(20, 10, 0, 0);
          ci.put({ id: `c${i}`, at: iso(t.getTime()), mood: 3 + (i % 3 === 0 ? 1 : 0), energy: 3 + (i % 4 === 0 ? -1 : i % 5 === 0 ? 1 : 0), appetite: 2 + (i % 3), sleepHours: i % 4 === 0 ? 5.9 : 7.3, sleepQuality: i % 4 === 0 ? 2 : 4,
            ...(lift ? { soreness: 1 + (i % 4) } : {}), chips: i % 5 === 0 ? ['Caffeine'] : i % 7 === 0 ? ['Alcohol'] : i % 9 === 0 ? ['Headache'] : [], ...stamp });
          if (i % 5 === 0) ci.put({ id: `cf${i}`, at: iso(t.getTime() - 5 * 3600000), chips: ['Caffeine'], ...stamp });
          dy.put({ id: `d${i}`, date: ymd(now - i * DAY), steps: 6500 + (i * 1373) % 6000, sleepMin: 390 + (i * 37) % 90, restingHr: 62 - Math.floor((60 - i) / 15), hrvMs: 44 + (i * 7) % 14,
            ...(lift && i < 40 ? { proteinG: 120 + (i * 13) % 50, waterMl: 1800 + (i * 211) % 1200 } : {}), ...stamp });
        }
        const vt = tx.objectStore('vitals');
        for (let i = 56; i >= 0; i -= 4) vt.put({ id: `vt${i}`, at: iso(now - i * DAY + 8 * 3600000), systolic: 126 - Math.floor((56 - i) / 8), diastolic: 82 - Math.floor((56 - i) / 12), heartRate: 66 - Math.floor((56 - i) / 14), ...stamp });
        const tg = tx.objectStore('tags');
        if (lift) {
          tg.put({ id: 'tgbag', medicationId: '', action: { kind: 'routine', routineId: 'rA' }, personId: 'me', label: 'Gym bag', createdAt: iso(now - 50 * DAY), lastScannedAt: iso(now - 2 * DAY) });
          tg.put({ id: 'tgbench', medicationId: '', action: { kind: 'exercise', exerciseId: 'bench' }, personId: 'me', label: 'Bench at the gym', createdAt: iso(now - 50 * DAY), lastScannedAt: iso(now - 2 * DAY) });
          tg.put({ id: 'tgbottle', medicationId: '', action: { kind: 'water', ml: 750 }, personId: 'me', label: 'Water bottle', createdAt: iso(now - 50 * DAY) });
        } else {
          tg.put({ id: 'tgscales', medicationId: '', action: { kind: 'weight' }, personId: 'me', label: 'Bathroom scales', createdAt: iso(now - 80 * DAY), lastScannedAt: iso(now - 3600000) });
          tg.put({ id: 'tgshake', medicationId: '', action: { kind: 'food', foodId: 'f1' }, personId: 'me', label: 'Protein tub', createdAt: iso(now - 40 * DAY), lastScannedAt: iso(now - DAY) });
        }
        if (!lift && names.includes('foods')) {
          const fd = tx.objectStore('foods'), fl = tx.objectStore('foodLogs');
          const foods = [
            { id: 'f1', name: 'Protein shake', kind: 'product', serving: '1 scoop in milk', nutrients: { kcal: 230, protein: 32, carbs: 14, fat: 5 }, favourite: true },
            { id: 'f2', name: 'Monster Ultra', brand: 'Monster', barcode: '9310258000035', kind: 'product', serving: '500 mL can', nutrients: { kcal: 10, protein: 0, carbs: 3, fat: 0, caffeine: 160 } },
            { id: 'f3', name: 'Chicken stir-fry', kind: 'meal', nutrients: { kcal: 560, protein: 42, carbs: 48, fat: 18, fibre: 7 }, portions: { palm: 2, cupped: 1, fist: 2, thumb: 1 } },
            { id: 'f4', name: 'Overnight oats', kind: 'meal', nutrients: { kcal: 380, protein: 18, carbs: 52, fat: 10, fibre: 8 } },
            { id: 'f5', name: 'Greek yoghurt and berries', kind: 'meal', nutrients: { kcal: 210, protein: 17, carbs: 24, fat: 4 } },
          ];
          for (const f of foods) fd.put({ ...f, ...stamp, lastUsedAt: iso(now - DAY) });
          for (let i = 30; i >= 0; i--) {
            const day0 = new Date(now - i * DAY); day0.setHours(0, 0, 0, 0);
            const at = (h) => iso(day0.getTime() + h * 3600000);
            const log = (id, f, h, s = 1) => { if (day0.getTime() + h * 3600000 > now) return; fl.put({ id: `l${i}${id}`, at: at(h), name: f.name, foodId: f.id, servings: s, nutrients: Object.fromEntries(Object.entries(f.nutrients).map(([k, v]) => [k, Math.round(v * s)])), personId: 'me', ...stamp }); };
            log('a', foods[3], 7.5); log('b', foods[0], 10.5); if (i % 2) log('c', foods[1], 14);
            log('d', foods[4], 12.5); log('e', foods[2], 19, i % 3 === 0 ? 1.25 : 1);
          }
        }
        if (lift) {
          tx.objectStore('routines').put({ id: 'rA', name: 'Push day', items: [{ exerciseId: 'bench', sets: 3, reps: 8 }, { exerciseId: 'ohp', sets: 3, reps: 8 }, { exerciseId: 'dip', sets: 3, reps: 10 }], personId: 'me', ...stamp });
          tx.objectStore('routines').put({ id: 'rB', name: 'Legs', items: [{ exerciseId: 'squat', sets: 3, reps: 5 }, { exerciseId: 'rdl', sets: 3, reps: 8 }], personId: 'me', ...stamp });
          const ws = tx.objectStore('workouts'); let n = 0;
          for (let i = 70; i >= 1; i--) {
            const t = new Date(now - i * DAY); t.setHours(6, 30, 0, 0); const wd = t.getDay();
            if (![1, 3, 5].includes(wd)) continue;
            const week = Math.floor((70 - i) / 7);
            const set = (exerciseId, weightKg, reps, warmup) => ({ id: `s${++n}`, exerciseId, weightKg, reps, done: true, ...(warmup ? { warmup: true } : {}) });
            const bench = Math.min(60 + week * 2.5, 82.5), squat = 80 + week * 5;
            const sets = wd === 5 ? [set('squat', 60, 5, true), ...[0, 1, 2].map(() => set('squat', squat, 5)), ...[0, 1, 2].map(() => set('rdl', 70 + week * 2.5, 8))]
              : [set('bench', 40, 10, true), ...[0, 1, 2].map(() => set('bench', bench, 8)), ...[0, 1, 2].map(() => set('ohp', 35 + week * 1.25, 8)), ...[0, 1, 2].map(() => set('dip', 0, 10))];
            ws.put({ id: `w${i}`, startedAt: iso(t.getTime()), endedAt: iso(t.getTime() + 3300000), name: wd === 5 ? 'Legs' : 'Push day', routineId: wd === 5 ? 'rB' : 'rA', source: 'manual', sets, personId: 'me', ...stamp });
            if (wd === 3) ws.put({ id: `r${i}`, startedAt: iso(t.getTime() + 11 * 3600000), endedAt: iso(t.getTime() + 11 * 3600000), sets: [], source: 'manual', cardio: { activity: 'run', distanceKm: 5, durationMin: 31 - week * 0.4 }, personId: 'me', ...stamp });
          }
        }
        const st = tx.objectStore('settings');
        if (lift) { st.put({ key: 'proteinTargetG', value: 150 }); st.put({ key: 'waterTargetMl', value: 2500 }); }
        else st.put({ key: 'energyTargetKcal', value: 1900 });
        st.put({ key: 'gettingStartedDismissed', value: false });
        tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error);
      };
      q.onerror = () => rej(q.error);
    });
  }, edition);
  await page.reload(); await page.waitForTimeout(1000);
}

/** TapDose: Vyvanse each morning (with focus check-ins that show it wearing off), melatonin at night, Panadol as needed,
 *  stock, tags, blood pressure, steps and sleep. */
export async function seedDose(page, base) {
  await page.goto(base);
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.waitForTimeout(800);
  await page.evaluate(async () => {
    const DAY = 86400000, now = Date.now(), iso = (t) => new Date(t).toISOString();
    const ymd = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const stamp = { createdAt: iso(now - 60 * DAY), updatedAt: iso(now) };
    const meds = [
      { id: 'vyv', name: 'Vyvanse', strength: 50, unit: 'mg', form: 'capsule', defaultAmount: 50, schedule: { type: 'fixed', slots: [{ time: '07:30' }] }, color: '#e8743b', icon: 'capsule', archived: false, stockCount: 18, lowStockAt: 7, ...stamp },
      { id: 'mel', name: 'Melatonin', strength: 2, unit: 'mg', form: 'tablet', defaultAmount: 2, schedule: { type: 'fixed', slots: [{ time: '21:30' }] }, color: '#7c5cff', icon: 'tablet', archived: false, stockCount: 41, ...stamp },
      { id: 'mag', name: 'Magnesium', strength: 300, unit: 'mg', form: 'tablet', defaultAmount: 300, schedule: { type: 'fixed', slots: [{ time: '21:30' }] }, color: '#2a9d8f', icon: 'tablet', archived: false, ...stamp },
      { id: 'pan', name: 'Panadol', strength: 500, unit: 'mg', form: 'tablet', defaultAmount: 1000, schedule: { type: 'prn', maxPer24h: 8, minHoursBetween: 4, maxAmountPer24h: 4000 }, color: '#2a78d6', icon: 'tablets', archived: false, stockCount: 20, ...stamp },
    ];
    const doses = [], checkIns = [];
    let n = 0;
    const d = (medicationId, t, amount) => { if (t <= now) doses.push({ id: `d${++n}`, medicationId, takenAt: iso(t), amount, source: 'tag', createdAt: iso(t), updatedAt: iso(t) }); };
    for (let i = 35; i >= 0; i--) {
      const day0 = new Date(now - i * DAY); day0.setHours(0, 0, 0, 0);
      const wd = day0.getDay(), late = i % 5 === 0;
      const t = day0.getTime() + (7.5 + (wd === 0 || wd === 6 ? 1.5 : 0) + (late ? 3 : 0)) * 3600000 + (i % 3) * 300000;
      if (!(wd === 0 && i < 21) && i > 0) { // not today: the screenshots show it still to take
        d('vyv', t, 50);
        if (t + 90 * 60000 < now) checkIns.push({ id: `a${i}`, at: iso(t + 90 * 60000), focus: 4, mood: 4, energy: 4, chips: [], ...stamp });
        if (t + 9.3 * 3600000 < now) checkIns.push({ id: `b${i}`, at: iso(t + 9.3 * 3600000), focus: 2, mood: 3, energy: 2, chips: ['Wearing off'], ...stamp });
      }
      if (i > 0) { d('mel', day0.getTime() + 21.6 * 3600000, 2); d('mag', day0.getTime() + 21.6 * 3600000, 300); }
      if (i % 6 === 2) d('pan', day0.getTime() + 14 * 3600000, 1000);
      if (i > 0) checkIns.push({ id: `s${i}`, at: iso(day0.getTime() + 7.2 * 3600000), sleepHours: late ? 5.9 : 7.4, sleepQuality: late ? 2 : 4, chips: i % 4 === 0 ? ['Headache'] : [], ...stamp });
      if (i % 3 === 0 && i > 0) checkIns.push({ id: `cf${i}`, at: iso(day0.getTime() + 15 * 3600000), chips: ['Caffeine'], ...stamp });
    }
    await new Promise((res, rej) => {
      const q = indexedDB.open('tapdose');
      q.onsuccess = () => {
        const db = q.result;
        const tx = db.transaction(['medications', 'doses', 'checkIns', 'tags', 'vitals', 'daily', 'settings', 'appointments', 'questions'], 'readwrite');
        for (const m of meds) tx.objectStore('medications').put(m);
        for (const x of doses) tx.objectStore('doses').put(x);
        for (const c of checkIns) tx.objectStore('checkIns').put(c);
        tx.objectStore('tags').put({ id: 'tvyv', medicationId: 'vyv', label: 'Bathroom shelf', createdAt: iso(now - 50 * DAY), lastScannedAt: iso(now - 2 * 3600000) });
        tx.objectStore('tags').put({ id: 'tmel', medicationId: 'mel', label: 'Bedside', createdAt: iso(now - 50 * DAY) });
        for (let i = 28; i >= 0; i -= 4) tx.objectStore('vitals').put({ id: `vt${i}`, at: iso(now - i * DAY - 3 * 3600000), systolic: 121 + (i % 5), diastolic: 78 + (i % 3), heartRate: 72 + (i % 6), ...stamp });
        for (let i = 40; i >= 1; i--) tx.objectStore('daily').put({ id: `dy${i}`, date: ymd(now - i * DAY), steps: 6000 + (i * 1373) % 6000, sleepMin: 380 + (i * 37) % 90, restingHr: 64 + (i % 4), ...stamp });
        tx.objectStore('appointments').put({ id: 'ap1', date: ymd(now + 9 * DAY), with: 'Dr Patel', ...stamp });
        tx.objectStore('appointments').put({ id: 'ap0', date: ymd(now - 28 * DAY), with: 'Dr Patel', ...stamp });
        tx.objectStore('questions').put({ id: 'q1', text: 'Is the afternoon dip worth a second dose?', createdAt: iso(now - 5 * DAY), updatedAt: iso(now) });
        tx.objectStore('settings').put({ key: 'remindersEnabled', value: true });
        tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error);
      };
    });
  });
  await page.reload(); await page.waitForTimeout(1000);
}
