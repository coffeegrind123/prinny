/**
 * Media the user chose to see while MSC4278 previews were off for its room.
 * The MSC asks that this consent be remembered so the same item does not ask
 * again; we remember it for the session, keyed by mxc URI, so scrolling an
 * image out of the virtualised timeline and back keeps it revealed. Nothing is
 * persisted: a restart asks again, which errs on the side the user chose.
 */
const revealed = new Set<string>();

export const isMediaRevealed = (mxc: string | undefined): boolean =>
  typeof mxc === 'string' && revealed.has(mxc);

export const revealMedia = (mxc: string | undefined): void => {
  if (typeof mxc === 'string' && mxc.length > 0) revealed.add(mxc);
};
