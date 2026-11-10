/**
 * Characters that change how text is shown without being visible themselves:
 *
 * - C0 controls except tab, LF and CR (U+0000–0008, 000B, 000C, 000E–001F)
 * - DEL and the C1 controls (U+007F–009F)
 * - bidi embeddings and overrides (U+202A–202E: LRE RLE PDF LRO RLO)
 * - bidi isolates (U+2066–2069: LRI RLI FSI PDI)
 *
 * An override reverses the text after it, so a name, topic or message can read
 * differently from what was sent ("invoice‮gpj.exe" shows as
 * "invoiceexe.jpg"). The LRM/RLM marks (U+200E, U+200F) are kept: they carry
 * no override and right-to-left text needs them.
 */
// eslint-disable-next-line no-control-regex
const UNSAFE_TEXT_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F‪-‮⁦-⁩]/g;

/** Remove invisible control and bidi override characters for display. Stored values stay raw. */
export const stripUnsafeTextChars = (text: string): string => text.replace(UNSAFE_TEXT_CHARS, '');

/** `stripUnsafeTextChars` for a value that may be absent. */
export const stripOptionalText = (text: string | undefined): string | undefined =>
  text === undefined ? undefined : stripUnsafeTextChars(text);
