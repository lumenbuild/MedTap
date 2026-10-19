// Minimal Web NFC types (Chrome on Android). Not in TypeScript's DOM lib yet.
interface NDEFRecordInit { recordType: string; data?: string | BufferSource; mediaType?: string }
interface NDEFMessageInit { records: NDEFRecordInit[] }
interface NDEFRecord { recordType: string; data?: DataView; encoding?: string }
interface NDEFReadingEvent extends Event { serialNumber: string; message: { records: NDEFRecord[] } }
declare class NDEFReader extends EventTarget {
  constructor();
  scan(options?: { signal?: AbortSignal }): Promise<void>;
  write(message: NDEFMessageInit | string, options?: { overwrite?: boolean; signal?: AbortSignal }): Promise<void>;
  onreading: ((e: NDEFReadingEvent) => void) | null;
  onreadingerror: ((e: Event) => void) | null;
}
