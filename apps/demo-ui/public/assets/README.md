# Architecture assets

Two graphics, both supplied for CP-H8 and both present.

| File | Intrinsic size | Where it appears | What it shows |
|---|---|---|---|
| `nomosdemo.png` | 1254 × 1254 | §06 *NOMOS architecture*, and as the `og:image` / `twitter:image` social preview | NOMOS as the governance centre of a federated agent ecosystem — the primary visual motif |
| `AgentNOMOS-12-Layer-Architecture-v1.png` | 1536 × 1024 | §06, inside the collapsed **“Technical architecture — historical twelve-layer diagram (superseded)”** disclosure | The historical AgentNOMOS twelve-layer diagram (ATLAS through ORBIS), preserved as supplied for this 2026 testnet demo. **Superseded:** the current canonical NOMOS Trust Chain is eleven stages, S0–S10 — see agentnomos.com |

Both were re-encoded losslessly on commit (PNG, `optimize=True`); the pixel data
is byte-identical to what was supplied and no dimension was changed. Neither
diagram's content was edited.

The page declares each image's intrinsic `width`/`height`, so the box is reserved
before the file arrives and the aspect ratio is the image's own — `object-fit:
contain` backs that up. Both sit far below the fold, so both are `loading="lazy"`.

## If a file goes missing

`app.js` swaps in a named slot naming the exact path it expects, rather than
showing a broken image or a substitute diagram. `tests/unit/demo-ui-page.test.ts`
asserts both references, both slots and both files.

## Before replacing an image

* Keep the technical content unchanged. The only permitted processing is lossless
  or near-lossless size reduction for web delivery.
* Update the `width`/`height` attributes in `index.html` if the dimensions change,
  and the `og:image:width` / `og:image:height` meta tags for `nomosdemo.png`.
* Update the alt text. It describes what is actually in the diagram, and a stale
  one is worse than a short one.
* The secret scanner skips binary extensions, so an image is never scanned for
  key material. Check by eye that no diagram contains an account id, a topic id
  or an internal path. Both current files were checked and contain none.
