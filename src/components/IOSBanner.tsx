import { Info, X } from 'lucide-react';
import { APP_NAME } from '../config';
import { isIOS, isStandalone } from '../platform';
import { setSetting } from '../db/repos/settings';

/** iOS home-screen apps keep separate storage from Safari, and tag taps always open Safari. */
export function IOSBanner({ dismissed }: { dismissed: boolean }) {
  if (!isIOS || !isStandalone || dismissed) return null;
  return (
    <div role="note" className="rounded-card bg-caution-soft p-4 flex gap-3">
      <Info className="text-caution shrink-0 mt-0.5" aria-hidden="true" />
      <p className="flex-1 text-sm">
        Tag taps open in Safari, which keeps separate data from this home-screen app. For tags to work, use {APP_NAME} in Safari.
        <a href="#/backup" className="block mt-2 font-semibold text-primary underline underline-offset-2">Move my data</a>
      </p>
      <button onClick={() => setSetting('iosBannerDismissed', true)} aria-label="Dismiss" className="w-12 h-12 -m-3 flex items-center justify-center text-muted">
        <X size={20} aria-hidden="true" />
      </button>
    </div>
  );
}
