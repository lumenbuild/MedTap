// Tag IDs: 8 characters, lower-case, no look-alike characters (0, 1, l, o, and no capitals so I/O can't appear).
// 32 symbols, so each random byte maps without bias.
export const TAG_ALPHABET = '23456789abcdefghijkmnpqrstuvwxyz';
export const TAG_ID_LENGTH = 8;

export function newTagId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TAG_ID_LENGTH));
  return Array.from(bytes, (b) => TAG_ALPHABET[b & 31]).join('');
}
