import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { Printer } from 'lucide-react';
import { APP_NAME } from '../../config';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';

/** Printable QR sticker with the same URL as the tag: a fallback for phones or tags that won't read. */
export function QrSheet({ url, medName, onClose }: { url: string | null; medName: string; onClose: () => void }) {
  const [src, setSrc] = useState('');
  const [showName, setShowName] = useState(false);
  useEffect(() => {
    if (url) QRCode.toDataURL(url, { margin: 1, width: 600, errorCorrectionLevel: 'M' }).then(setSrc);
  }, [url]);

  if (!url) return null;
  const caption = showName ? medName : `Scan to log · ${APP_NAME}`;
  return (
    <Sheet open onClose={onClose} title="QR sticker">
      <div className="space-y-4 text-center">
        {src && <img src={src} alt={`QR code for ${url}`} className="mx-auto w-52 h-52 rounded-btn bg-white p-2" />}
        <p className="text-sm text-muted break-all">{url}</p>
        <p className="text-sm">Scanning this with the phone's camera opens the same screen as tapping the tag.</p>
        <label className="flex items-center gap-3 min-h-[48px] text-left">
          <input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} className="w-5 h-5 accent-[var(--primary)]" />
          <span>Print the medication name on the sticker</span>
        </label>
        <Button className="w-full min-h-[56px] flex items-center justify-center gap-2" onClick={() => window.print()} disabled={!src}>
          <Printer size={20} aria-hidden="true" /> Print stickers
        </Button>
      </div>
      {src && createPortal(
        <div id="print-root">
          <div className="print-grid">
            {Array.from({ length: 6 }, (_, i) => (
              <figure key={i} className="print-sticker">
                <img src={src} alt="" />
                <figcaption>{caption}</figcaption>
              </figure>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </Sheet>
  );
}
