import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { format } from 'date-fns';
import QRCode from 'qrcode';
import { Printer } from 'lucide-react';
import type { Medication, PeptideVial } from '../../db/schema';
import { useTags } from '../../app/data';
import { printPage } from '../../app/print';
import { tagUrl } from '../../nfc/url';
import { concentration, isPen } from '../../logic/peptide';
import { fmtAmount } from '../../logic/format';
import { Sheet, SheetActions } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { APP_NAME } from '../../config';

const day = (ms: number) => format(ms, 'd MMM yyyy');

/** What goes on a vial: the peptide, its strength once mixed, when it was mixed and when to stop using it. */
export function vialLabelLines(med: Medication, vial: PeptideVial, useBy?: number): string[] {
  const water = vial.waterMl;
  const conc = water ? concentration(vial.amount, water) : NaN;
  return [
    water && Number.isFinite(conc)
      ? `${fmtAmount(vial.amount, med.unit)} + ${water} mL = ${fmtAmount(Math.round(conc * 1000) / 1000, med.unit)}/mL`
      : fmtAmount(vial.amount, med.unit),
    vial.startedAt ? `${isPen(med) ? 'Started' : 'Mixed'} ${day(Date.parse(vial.startedAt))}` : '',
    useBy ? `Use by ${day(useBy)}` : '',
    vial.lot ? `Lot ${vial.lot}` : '',
  ].filter(Boolean);
}

/** A printable label for the vial in use, with the QR code of its tag (if it has one) as a backup to tapping. */
export function VialLabelSheet({ med, vial, useBy, onClose }: { med: Medication; vial: PeptideVial; useBy?: number; onClose: () => void }) {
  const tag = useTags()?.find((t) => t.medicationId === med.id && t.vialId === vial.id);
  const [src, setSrc] = useState('');
  const lines = vialLabelLines(med, vial, useBy);
  useEffect(() => {
    document.body.classList.add('print-portal');
    return () => document.body.classList.remove('print-portal');
  }, []);
  useEffect(() => {
    if (tag) QRCode.toDataURL(tagUrl(tag.id), { margin: 1, width: 400, errorCorrectionLevel: 'M' }).then(setSrc);
    else setSrc('');
  }, [tag]);
  const label = (
    <div className="vial-label">
      <div className="min-w-0">
        <p className="vial-label-name">{med.name}</p>
        {lines.map((l) => <p key={l}>{l}</p>)}
      </div>
      {src && <img src={src} alt="" />}
    </div>
  );
  return (
    <Sheet open onClose={onClose} title={`${isPen(med) ? 'Pen' : 'Vial'} label`}>
      <div className="space-y-4">
        <div className="rounded-btn border border-border-strong p-4" aria-label="Label preview">{label}</div>
        <p className="text-sm text-muted">{tag ? 'The QR code opens the same screen as tapping the tag.' : `Tag this ${isPen(med) ? 'pen' : 'vial'} to add a QR code to its label.`}</p>
        <SheetActions>
          <Button className="w-full min-h-[56px] flex items-center justify-center gap-2" onClick={() => printPage(`${APP_NAME} vial label`)}>
            <Printer size={20} aria-hidden="true" /> Print label
          </Button>
        </SheetActions>
      </div>
      {createPortal(<div id="print-root"><div className="print-vial">{label}</div></div>, document.body)}
    </Sheet>
  );
}
