import { isNative } from '../platform';
import { MedTapNative } from '../nfc/native';

/** Print or save as PDF. App web views don't support window.print(), so the native app prints itself. */
export function printPage(name: string) {
  if (isNative) void MedTapNative.print({ name }).catch((e) => console.error('print', e));
  else window.print();
}
