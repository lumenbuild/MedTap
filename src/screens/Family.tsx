import { useState } from 'react';
import { Users } from 'lucide-react';
import type { Person } from '../db/schema';
import { DEFAULT_PERSON } from '../db/schema';
import { addPerson, personRecordCount, removePerson, renamePerson } from '../db/repos/people';
import { setSetting } from '../db/repos/settings';
import { useFamily } from '../app/data';
import { useToast } from '../app/toast';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Sheet } from '../components/ui/Sheet';
import { TextInput } from '../components/ui/Field';
import { PersonBadge } from '../components/PersonSwitcher';

/** Settings card: track medications, check-ins and body for more than one person. */
export function FamilyCard() {
  const fam = useFamily();
  const toast = useToast();
  const [editing, setEditing] = useState<Person | 'new' | null>(null);
  const [name, setName] = useState('');
  const [blocked, setBlocked] = useState('');
  if (!fam) return null;

  const open = (p: Person | 'new') => { setEditing(p); setName(p === 'new' ? '' : p.name); setBlocked(''); };
  const save = async () => {
    const n = name.trim();
    if (!n || !editing) return;
    if (editing === 'new') {
      const p = await addPerson(n);
      await setSetting('activePersonId', p.id);
      await setSetting('todayEveryone', false);
      toast(`Added ${n}. Add their medications in Meds.`);
    } else {
      await renamePerson(editing.id, n);
      toast('Saved');
    }
    setEditing(null);
  };
  const remove = async (p: Person) => {
    const n = await personRecordCount(p.id);
    if (n > 0) { setBlocked(`${p.name} has ${n} medication${n === 1 ? '' : 's'} or record${n === 1 ? '' : 's'}. Archive or delete their medications and entries first, so no history is lost by accident.`); return; }
    await removePerson(p.id);
    if (fam.personId === p.id) await setSetting('activePersonId', DEFAULT_PERSON);
    toast(`Removed ${p.name}`);
    setEditing(null);
  };

  return (
    <Card className="space-y-3">
      <h2 className="text-lg font-semibold flex items-center gap-2"><Users size={20} className="text-primary" aria-hidden="true" /> Family members</h2>
      <p className="text-sm text-muted">
        {fam.many
          ? 'Each person has their own medications, check-ins and body tracking. Choose who to show at the top of Today, Trends, Body and Meds. Tags always open the right person.'
          : 'Track medications for someone else too, like a child or a parent you care for. Each person gets their own medications, check-ins and charts.'}
      </p>
      <ul className="-mx-2">
        {fam.people.map((p) => (
          <li key={p.id}>
            <button onClick={() => open(p)} className="w-full min-h-[56px] flex items-center gap-3 px-2 rounded-btn text-left hover:bg-surface-2">
              <PersonBadge name={p.name} size={36} />
              <span className="flex-1 font-medium">{p.name}</span>
              <span className="text-sm text-primary font-semibold">Edit</span>
            </button>
          </li>
        ))}
      </ul>
      <Button variant="secondary" className="w-full" onClick={() => open('new')}>Add a family member</Button>

      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add a family member' : 'Edit family member'}>
        <div className="space-y-4">
          <TextInput label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="off"
            placeholder={editing === 'new' ? 'e.g. Sam' : undefined} onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
          <Button className="w-full min-h-[56px]" onClick={save} disabled={!name.trim()}>{editing === 'new' ? 'Add' : 'Save'}</Button>
          {editing && editing !== 'new' && editing.id !== DEFAULT_PERSON && (
            <>
              <Button variant="danger" className="w-full" onClick={() => remove(editing)}>Remove {editing.name}</Button>
              {blocked && <p className="text-sm rounded-btn bg-caution-soft p-3" role="alert">{blocked}</p>}
            </>
          )}
        </div>
      </Sheet>
    </Card>
  );
}
