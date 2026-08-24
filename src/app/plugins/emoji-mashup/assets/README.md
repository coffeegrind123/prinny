# Twemoji face parts

Vendored from [Ryhon0/open-emoji-mash](https://github.com/Ryhon0/open-emoji-mash),
which sliced them out of [Twemoji](https://github.com/twitter/twemoji)
(graphics CC-BY 4.0, Twitter Inc. and other contributors). The slicing follows
[@EmojiMashupBot](https://knowyourmeme.com/memes/sites/emoji-mashup-bot).

Layout:

| Directory      | Files | What it is                                                    |
| -------------- | ----- | ------------------------------------------------------------- |
| `base/`        | 39    | Head shapes keyed by codepoint — moon, cat, robot, skull, …    |
| `base-shared/` | 7     | Head shapes many emoji share, keyed by name via `bases.json`   |
| `eyes/`        | 136   | Eye layers keyed by codepoint                                  |
| `mouth/`       | 129   | Mouth layers keyed by codepoint                                |
| `special/`     | 37    | Extras that ride along with a mouth — tears, sweat, halo, mask |
| `bases.json`   | —     | 96 codepoints → the `base-shared/` name they use               |

**Every part is a complete `viewBox="0 0 36 36"` overlay** in Twemoji's own
coordinate space. That is the property the whole feature rests on: a mashup is
a plain stack of four layers, with no offsets and no per-base special cases.

The files are not byte-identical to upstream. Each was run through the
optimiser described in `../parts.ts` — the XML prolog, Inkscape/sodipodi
metadata and **every `id` attribute** are gone, taking the set from 742 KB to
233 KB. Dropping the ids is what makes it safe to concatenate four parts into
one SVG without renaming anything: no part references an id (no `url(#…)`, no
`xlink:href`), so there is nothing for a collision to break.

To re-vendor, re-run that optimiser over a fresh `open-emoji-mash` checkout.
Keep `viewBox="0 0 36 36"` intact — `parts.ts` asserts on it in development.
