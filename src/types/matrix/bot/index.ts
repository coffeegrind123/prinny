/**
 * `app.prinny.bot.*` — the Telegram-style bot protocol.
 *
 * VENDORED. The canonical copy of `constants.ts`, `types.ts` and `validate.ts`
 * lives in the `@prinny/bot` package, under `src/protocol/`, alongside the
 * specification at `spec/app.prinny.bot.md`. They are duplicated here rather
 * than imported so that the client has no dependency on the bot framework —
 * a client must be able to render these events without being able to send
 * them.
 *
 * The only edit made on the way in is dropping `.js` from the relative
 * imports, which cinny's bundler resolution does not use. Keep the rest
 * byte-identical: `validate.ts` in particular is the boundary between an
 * arbitrary room member and this renderer, and a local "improvement" that
 * diverges from the bot side is how a keyboard starts rendering differently
 * from the way it was sent.
 */

export * from './constants';
export * from './types';
export * from './validate';
export * from './msc4391';
