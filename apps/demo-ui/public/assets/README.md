# Asset slots

Two architecture graphics are referenced by the page and are **not in this
repository**. Until each file is present at the exact path below, the page shows
a named, dashed slot in its place — deliberately, rather than a broken image or
an invented substitute diagram.

| Expected file | Where it appears | What it shows |
|---|---|---|
| `nomosdemo.png` | §06 *NOMOS architecture*, above the fold of that section, and as the `og:image` / `twitter:image` social preview | NOMOS as the governance centre of a federated agent ecosystem — the primary visual motif |
| `1779269452389.jpg` | §06, inside the collapsed **“Technical architecture — the twelve layers”** disclosure | The detailed twelve-layer architecture view |

Drop the files here and reload. Nothing else needs to change: `index.html`
already references them, `app.js` hides the slot as soon as an image decodes,
and `tests/unit/demo-ui-page.test.ts` asserts both references and both slots
exist.

## Before committing an image

* Keep the technical content unchanged. These are the supplied graphics; the
  only permitted processing is lossless or near-lossless size reduction for web
  delivery.
* Prefer a width around 1600–2000 px. The frame is fluid, so anything wider is
  bandwidth without benefit.
* `nomosdemo.png` doubles as the social preview. A 1200×630 crop is the
  conventional aspect ratio if one is needed; the full diagram is used as-is
  otherwise.
* The secret scanner skips binary extensions, so an image is never scanned for
  key material. Check by eye that no diagram contains an account id, a topic id
  or an internal path before it is committed.
