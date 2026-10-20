import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { CircleAlert, Copy, FileDown, FileUp, RefreshCw, Share2, Smartphone } from 'lucide-react';
import { APP_NAME } from '../config';
import { useNow } from '../app/useNow';
import { useFamily } from '../app/data';
import { useLive } from '../db/live';
import { useToast } from '../app/toast';
import { go, replace } from '../app/router';
import { shareOrDownload } from '../app/files';
import { exportUpdateFile, hasOwnRecords, importUpdateFile, join, leaveSync, renameDevice, setRelay, startSync, syncNow, useSyncConfig, type SyncConfig } from '../app/sync';
import { decodeInvite, encodeInvite, isRelayUrl, type Invite } from '../logic/sync';
import { fmtAgo } from '../logic/format';
import { tagBase } from '../nfc/url';
import { canShare } from '../platform';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Sheet } from '../components/ui/Sheet';
import { TextArea, TextInput } from '../components/ui/Field';

/** "Me" on this phone, unless it was never given a name. */
function useMyName(): string {
  const fam = useFamily();
  const n = fam?.nameOf('me') ?? '';
  return n === 'Me' ? '' : n;
}
const inviteLink = (i: Invite) => `${tagBase()}#/join/${encodeInvite(i)}`;

const WARNING = `Anyone with this invite can see and change everything in ${APP_NAME} on your family's phones: every person, medication and dose. Only share it with people you trust, and send it privately.`;

export function Sync() {
  const cfg = useSyncConfig();
  if (cfg === undefined) return <div className="h-60 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;
  return cfg ? <SyncOn cfg={cfg} /> : <SyncOff />;
}

function About() {
  return (
    <Card className="space-y-2">
      <h2 className="text-lg font-semibold">Share records between phones</h2>
      <p>Family sync keeps {APP_NAME} the same on your phones and your family's: medications, doses, check-ins, weight, blood pressure and tags. A dose logged on one phone shows on the others, and stock counts stay right.</p>
      <p className="text-sm text-muted">Everything is encrypted on the phone before it leaves. Only phones you invite have the key. Photos and settings stay on each phone.</p>
    </Card>
  );
}

function SyncOff() {
  const toast = useToast();
  const myName = useMyName();
  const [typed, setName] = useState<string | null>(null);
  const name = typed ?? myName;
  const [joining, setJoining] = useState(false);
  const [code, setCode] = useState('');
  const invite = decodeInvite(code);
  return (
    <div className="space-y-4">
      <About />
      <Card className="space-y-3">
        <TextInput label="Your name" help="Who uses this phone. The others see your records under this name." value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" />
        <Button className="w-full min-h-[56px]" disabled={!name.trim()} onClick={async () => { await startSync(name); toast('Family sync is on. Now invite another phone.'); }}>
          Start family sync
        </Button>
        <Button variant="secondary" className="w-full" onClick={() => setJoining(true)}>Join with an invite</Button>
        <p className="text-sm text-muted">Start on one phone, then invite the others. If another phone has already started, join with its invite instead.</p>
      </Card>
      <Sheet open={joining} onClose={() => setJoining(false)} title="Join with an invite">
        <div className="space-y-3">
          <p>On the phone that started family sync, open Settings → Family sync → <strong>Invite a phone</strong>. Scan its QR code with this phone's camera, or paste the invite here.</p>
          <TextArea label="Invite" rows={3} value={code} onChange={(e) => setCode(e.target.value)} error={code.trim() && !invite ? "That isn't a complete invite. Copy it again." : undefined} />
          <Button className="w-full min-h-[56px]" disabled={!invite || !name.trim()} onClick={async () => {
            if (!invite) return;
            await join(invite, name);
            setJoining(false);
            toast('Joined. Records will merge when the phones sync.');
          }}>Join</Button>
        </div>
      </Sheet>
    </div>
  );
}

function SyncOn({ cfg }: { cfg: SyncConfig }) {
  const toast = useToast();
  const now = useNow(30_000);
  const [inviting, setInviting] = useState(false);
  const [relay, setRelayText] = useState(cfg.relay ?? '');
  const [name, setName] = useState(cfg.deviceName);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const peers = Object.entries(cfg.peers).sort((a, b) => b[1].seen - a[1].seen);
  const relayValid = !relay.trim() || isRelayUrl(relay.trim());

  const sync = async () => { setBusy(true); await syncNow(); setBusy(false); };
  const send = async () => {
    const blob = await exportUpdateFile();
    await shareOrDownload(`${APP_NAME} update from ${cfg.deviceName}.medtapsync`, blob, `${APP_NAME} family update`);
  };
  const open = async (file?: File) => {
    if (!file) return;
    try {
      const from = await importUpdateFile(file);
      toast(`Merged the update from ${from}`);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Smartphone size={20} className="text-primary" aria-hidden="true" /> Family sync is on</h2>
        <p className="text-sm text-muted tnum">
          {cfg.relay
            ? cfg.lastSyncAt ? `Last synced ${fmtAgo(now - Date.parse(cfg.lastSyncAt))}.` : 'Not synced yet.'
            : 'No sync server, so phones swap update files (below).'}
        </p>
        {cfg.lastError && <p role="alert" className="text-sm rounded-btn bg-caution-soft p-3 flex gap-2"><CircleAlert size={18} className="shrink-0" aria-hidden="true" /> {cfg.lastError}</p>}
        <div>
          <h3 className="font-semibold">Phones</h3>
          <ul className="mt-1 divide-y divide-border">
            <li className="py-2 flex justify-between gap-3"><span>{cfg.deviceName} <span className="text-muted">(this phone)</span></span></li>
            {peers.map(([id, p]) => (
              <li key={id} className="py-2 flex justify-between gap-3">
                <span>{p.name}</span>
                <span className="text-sm text-muted tnum">updated {fmtAgo(now - Date.parse(p.exportedAt))}</span>
              </li>
            ))}
          </ul>
          {!peers.length && <p className="text-sm text-muted mt-1">No other phones yet. Invite one below.</p>}
        </div>
        {cfg.relay && (
          <Button variant="secondary" className="w-full flex items-center justify-center gap-2" onClick={sync} disabled={busy}>
            <RefreshCw size={18} className={busy ? 'animate-spin' : ''} aria-hidden="true" /> {busy ? 'Syncing…' : 'Sync now'}
          </Button>
        )}
        <Button className="w-full min-h-[56px]" onClick={() => setInviting(true)}>Invite a phone</Button>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-semibold">Update files</h2>
        <p className="text-sm text-muted">Without a sync server, send this phone's records to another phone as a file (Messages, email, AirDrop), and open theirs here. Each file can only be opened by your family's phones.</p>
        <input ref={fileRef} type="file" className="hidden" onChange={(e) => { void open(e.target.files?.[0]); e.target.value = ''; }} />
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" className="flex items-center justify-center gap-2" onClick={send}><FileUp size={18} aria-hidden="true" /> Send update</Button>
          <Button variant="secondary" className="flex items-center justify-center gap-2" onClick={() => fileRef.current?.click()}><FileDown size={18} aria-hidden="true" /> Open update</Button>
        </div>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-semibold">Sync server (optional)</h2>
        <p className="text-sm text-muted">With a sync server, phones sync by themselves every few minutes. It only ever stores encrypted data. You can set up your own for free: see <strong>sync-relay</strong> in {APP_NAME}'s code.</p>
        <TextInput label="Server address" placeholder="https://medtap-sync.example.workers.dev" inputMode="url" autoComplete="off" value={relay}
          onChange={(e) => setRelayText(e.target.value)} error={relayValid ? undefined : 'The address should start with https://'} />
        <Button variant="secondary" className="w-full" disabled={!relayValid || relay.trim() === (cfg.relay ?? '')} onClick={async () => {
          await setRelay(relay);
          toast(relay.trim() ? 'Saved. Invite the other phones again so they use it too.' : 'Sync server removed');
          void syncNow();
        }}>Save</Button>
      </Card>

      <Card className="space-y-3">
        <TextInput label="This phone's name" value={name} onChange={(e) => setName(e.target.value)} />
        <Button variant="secondary" className="w-full" disabled={!name.trim() || name.trim() === cfg.deviceName} onClick={async () => { await renameDevice(name); toast('Renamed'); }}>Rename</Button>
        <button className="w-full min-h-[48px] text-danger font-semibold" onClick={() => setLeaving(true)}>Stop syncing on this phone</button>
      </Card>

      <InviteSheet open={inviting} onClose={() => setInviting(false)} invite={{ key: cfg.key, relay: cfg.relay }} />
      <Sheet open={leaving} onClose={() => setLeaving(false)} title="Stop syncing on this phone?">
        <div className="space-y-3">
          <p>Everything stays on this phone, but it won't get changes from the other phones any more. To join again, you'll need a new invite.</p>
          <Button variant="danger" className="w-full min-h-[56px]" onClick={async () => { await leaveSync(); setLeaving(false); toast('Family sync is off on this phone'); }}>Stop syncing</Button>
        </div>
      </Sheet>
    </div>
  );
}

function InviteSheet({ open, onClose, invite }: { open: boolean; onClose: () => void; invite: Invite }) {
  const toast = useToast();
  const link = inviteLink(invite);
  const [qr, setQr] = useState('');
  useEffect(() => { if (open) QRCode.toDataURL(link, { margin: 1, width: 600, errorCorrectionLevel: 'M' }).then(setQr); }, [open, link]);
  return (
    <Sheet open={open} onClose={onClose} title="Invite a phone">
      <div className="space-y-3">
        <p className="rounded-btn bg-caution-soft p-3 text-sm">{WARNING}</p>
        <p>On the other phone, scan this with the camera. It opens {APP_NAME} and asks to join.</p>
        {qr && <img src={qr} alt="Invite QR code" className="w-64 h-64 mx-auto rounded-btn bg-white p-2" />}
        <Button variant="secondary" className="w-full flex items-center justify-center gap-2" onClick={async () => {
          try { await navigator.clipboard.writeText(link); toast('Invite copied. Send it privately.'); } catch { toast("Couldn't copy"); }
        }}><Copy size={18} aria-hidden="true" /> Copy invite</Button>
        {canShare && (
          <Button variant="secondary" className="w-full flex items-center justify-center gap-2" onClick={() => navigator.share({ title: `${APP_NAME} family invite`, url: link }).catch(() => {})}>
            <Share2 size={18} aria-hidden="true" /> Share invite
          </Button>
        )}
      </div>
    </Sheet>
  );
}

/** Opened from an invite link or QR code: #/join/<invite>. */
export function JoinSync({ code }: { code: string }) {
  const toast = useToast();
  const cfg = useSyncConfig();
  const invite = decodeInvite(code);
  const myName = useMyName();
  const [typed, setName] = useState<string | null>(null);
  const name = typed ?? myName;
  const own = useLive(() => hasOwnRecords(), []);
  if (cfg === undefined || own === undefined) return null;
  if (!invite) return <Card><p>This invite isn't complete. Ask for it to be sent again.</p></Card>;
  if (cfg) {
    return (
      <Card className="space-y-3">
        <p>{cfg.key === invite.key ? 'This phone is already in this family.' : 'This phone already syncs with a family. To join this one, stop syncing first (Settings → Family sync).'}</p>
        <Button className="w-full" onClick={() => replace('/sync')}>Family sync</Button>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      <About />
      <Card className="space-y-3">
        <h2 className="text-lg font-semibold">Join this family?</h2>
        <p className="text-sm">From then on, changes on any phone show on all of them.{own ? " What's already on this phone is kept and shared, under your name." : ''}</p>
        <TextInput label="Your name" help="Who uses this phone." value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" />
        <Button className="w-full min-h-[56px]" disabled={!name.trim()} onClick={async () => {
          await join(invite, name);
          toast(invite.relay ? 'Joined. Syncing now.' : 'Joined. Swap update files to sync.');
          replace('/sync');
        }}>Join</Button>
        <Button variant="secondary" className="w-full" onClick={() => go('/today')}>Not now</Button>
      </Card>
    </div>
  );
}
