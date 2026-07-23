/**
 * The demo page itself (CP-H8) — a static audit.
 *
 * There is no DOM here and no browser. What these tests check is what a
 * reviewer would check by reading the shipped files: that the page makes only
 * claims the evidence supports, that it has no way to spend money or write
 * anything, that it reaches no third party, and that the digest it invites a
 * visitor to recompute in their browser is computed the same way the Node
 * implementation computes it.
 *
 * The last one matters most. A canonicalizer that has quietly diverged turns an
 * honest check into a decorative one, and a decorative check is worse than none.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, sep } from "node:path";

import { buildDemoEvidence, REPO_ROOT, EVIDENCE_SOURCES } from "../../apps/demo-ui/src/evidence-model.ts";
import { canonicalDigest, canonicalString } from "../../packages/shared-schemas/src/canonical.ts";
import { receiptId } from "../../packages/shared-schemas/src/ids.ts";
import { resolveStaticPath, PUBLIC_DIR } from "../../apps/demo-ui/serve.ts";
import { classifyLiveCheck } from "../../apps/demo-ui/src/anchor-model.ts";

const PUBLIC = "apps/demo-ui/public";

function read(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

const html = read(`${PUBLIC}/index.html`);
const css = read(`${PUBLIC}/styles.css`);
const app = read(`${PUBLIC}/app.js`);
const jcsSource = read(`${PUBLIC}/jcs.js`);
const data = read(`${PUBLIC}/evidence-data.js`);

/** Everything a visitor's browser receives. */
const shipped = [html, css, app, jcsSource, data].join("\n");
/** Everything a visitor actually *reads* — prose and rendered values. */
const prose = [html, app, data].join("\n");

const evidence = buildDemoEvidence();

function get(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** Lines carrying `pattern`, so a claim can be judged in its own context. */
function linesWith(text: string, pattern: RegExp): string[] {
  return text.split("\n").filter((line) => pattern.test(line));
}

const NEGATED = /\b(no|not|never|without|neither|nor|non-|nothing|none|pending|only)\b/i;

// ─────────────────────────────────────────────────────────────────────────────

describe("demo page — public claims", () => {
  test("mainnet is mentioned only to be ruled out", () => {
    for (const line of linesWith(prose, /mainnet/i)) {
      assert.match(
        line,
        NEGATED,
        `"${line.trim()}" mentions mainnet without ruling it out — CP-H8 makes no mainnet claim`,
      );
    }
  });

  test("liveness is claimed nowhere — the page shows stored evidence", () => {
    for (const line of linesWith(prose, /\blive (data|feed|query|queries|updates?|status|monitoring)\b/i)) {
      assert.match(
        line,
        NEGATED,
        `"${line.trim()}" implies a live source; this page renders recorded evidence`,
      );
    }
    // Uppercase LIVE used to be banned outright, when the page had no network
    // path at all. CP-H8 introduced one — an opt-in anchor re-check — and with
    // it a state whose whole job is to say the check could NOT run. The ban
    // narrows rather than lifts: the only permitted uppercase LIVE is that
    // unavailability state.
    for (const line of linesWith(prose, /\bLIVE\b/)) {
      assert.match(
        line.replace(/live_verification_unavailable/gi, ""),
        /LIVE VERIFICATION UNAVAILABLE|LIVE_UNAVAILABLE|^[^L]*$/,
        `"${line.trim()}" uses LIVE for something other than declaring a check unavailable`,
      );
    }
    assert.doesNotMatch(prose, /\bLIVE (DATA|FEED|STATUS|MONITORING)\b/);
  });

  test("no mainnet endpoint or explorer link is shipped", () => {
    assert.doesNotMatch(shipped, /mainnet\.mirrornode\.hedera\.com/);
    assert.doesNotMatch(shipped, /hashscan\.io\/mainnet/);
    assert.doesNotMatch(shipped, /previewnet/i);
  });

  test("the forbidden marketing claims appear nowhere", () => {
    const forbidden: readonly RegExp[] = [
      /production[- ]ready/i,
      /independently (verified|audited|certified|reviewed)/i,
      /third[- ]party (certification|certified|audit\b)/i,
      /externally audited/i,
      /\bzero[- ]risk\b/i,
      /mathematically (perfect|proven safe)/i,
      /autonomous treasury/i,
      /HCS[- ]anchored/i,
      /\banchored to (the )?(HCS|consensus service)\b/i,
      /\bpay now\b/i,
      /connect (your )?wallet/i,
      /audited by/i,
      /certified by/i,
    ];
    for (const pattern of forbidden) {
      assert.doesNotMatch(prose, pattern, `the page must not claim ${pattern}`);
    }
  });

  test("verification is attributed to ledger evidence, not to an independent party", () => {
    assert.match(prose, /Mirror Node/);
    assert.ok(
      /verified against (Hedera )?(ledger|Mirror Node)/i.test(prose),
      "the page should say what it was verified against",
    );
  });

  test("the testnet label is in the static markup, so it survives an evidence failure", () => {
    assert.match(html, /Hedera&nbsp;Testnet|Hedera Testnet/);
    assert.match(html, /Verified Testnet Demonstration/);
  });

  test("the data is labelled as recorded, never as live", () => {
    assert.match(html, /Recorded&nbsp;evidence|Recorded evidence/);
    assert.match(html, /performs no live query/i);
  });

  test("HCS anchoring is presented only as pending", () => {
    assert.match(prose, /NOT[_ ]YET[_ ]ANCHORED/);
    assert.match(prose, /CP-H7/);
    for (const line of linesWith(prose, /\banchor(ed|ing)?\b/i)) {
      assert.doesNotMatch(
        line,
        /\b(successfully|has been|was) anchored\b/i,
        `"${line.trim()}" states anchoring as done`,
      );
    }
  });

  test("the headline claim is exactly the one the evidence supports", () => {
    assert.match(html, /NOMOS Governed/);
    assert.match(html, /x402 Settlement/);
    assert.match(
      html,
      /policy-bound autonomous payment, executed on Hedera Testnet and verified\s+against ledger evidence/,
    );
  });
});

describe("demo page — it cannot spend, write, or phone home", () => {
  test("the page opens no channel and phones nobody home", () => {
    for (const [name, source] of [["app.js", app], ["jcs.js", jcsSource], ["evidence-data.js", data]] as const) {
      assert.doesNotMatch(source, /XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts/, `${name} must not open a channel`);
      assert.doesNotMatch(source, /navigator\.(sendBeacon|serviceWorker)/, `${name} must not use ${name}`);
    }
    assert.doesNotMatch(jcsSource, /\bfetch\s*\(/, "jcs.js must not fetch");
    assert.doesNotMatch(data, /\bfetch\s*\(/, "evidence-data.js must not fetch");
  });

  test("the only request is one the reader asks for, to the pinned mirror message", () => {
    // CP-H8 added a live anchor re-check. It is the single network call in the
    // page, and it exists because a live verification that cannot fail is not a
    // verification. The invariant that replaced "never fetch" is narrower and
    // still meaningful: nothing fires on load, and the URL is not composable.
    const calls = app.match(/\bfetch\s*\(/g) ?? [];
    assert.equal(calls.length, 1, "app.js should contain exactly one fetch");
    assert.match(app, /fetch\(a\.mirror_url,/, "the fetch target must come from the evidence, not from a string");
    // It sits inside a click handler, so nothing is requested until asked.
    const idx = app.indexOf("fetch(a.mirror_url,");
    const handler = app.lastIndexOf('button.addEventListener("click"', idx);
    assert.ok(handler > 0 && handler < idx, "the fetch must be inside the click handler");
    assert.equal(evidence.anchor.mirror_url.startsWith("https://testnet.mirrornode.hedera.com/"), true);
  });

  test("an unreachable network reads as unavailable, never as unanchored or invalid", () => {
    const unreachable = classifyLiveCheck({ kind: "network_error" }, "x");
    assert.equal(unreachable.state, "LIVE_VERIFICATION_UNAVAILABLE");
    assert.notEqual(unreachable.state, "NOT_YET_ANCHORED");
    assert.notEqual(unreachable.state, "ANCHOR_EVIDENCE_INVALID");
    const http = classifyLiveCheck({ kind: "http_error", status: 503 }, "x");
    assert.equal(http.state, "LIVE_VERIFICATION_UNAVAILABLE");
    // The browser twin must agree with the tested implementation.
    assert.match(app, /LIVE_VERIFICATION_UNAVAILABLE/);
    assert.match(app, /says nothing about the anchor/);
  });

  test("no wallet, signer or payment surface exists", () => {
    const banned = /window\.ethereum|walletconnect|metamask|web3|@hashgraph|hashconnect|blade\s*wallet|privateKey|signTransaction|TransferTransaction/i;
    assert.doesNotMatch(app, banned);
    assert.doesNotMatch(html, banned);
    assert.doesNotMatch(data, banned);
  });

  test("no form and no write-shaped control is present", () => {
    assert.doesNotMatch(html, /<form\b/i);
    assert.doesNotMatch(html, /<input\b/i);
    assert.doesNotMatch(html, /type="submit"/i);
    for (const match of html.match(/<button[^>]*>/gi) ?? []) {
      assert.match(match, /type="button"/, `every button must be inert: ${match}`);
    }
  });

  test("the receipt is displayed, never re-created", () => {
    assert.doesNotMatch(app, /buildProofOfActionReceipt|LocalEd25519Signer|\bsign\s*\(/);
    assert.doesNotMatch(jcsSource, /\bsign\s*\(|Ed25519/);
    // The only crypto call is a digest.
    const cryptoCalls = jcsSource.match(/subtle\.\w+/g) ?? [];
    assert.deepEqual([...new Set(cryptoCalls)], ["subtle.digest"]);
  });

  test("no external asset is referenced — the page renders offline", () => {
    const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
    for (const ref of refs) {
      const external = /^https?:\/\//i.test(ref) || ref.startsWith("//");
      assert.equal(external, false, `${ref} is loaded from another host`);
    }
    assert.doesNotMatch(html, /<link[^>]+fonts\./i);
    assert.doesNotMatch(css, /@import|url\(\s*['"]?https?:/i);
    assert.doesNotMatch(shipped, /googletagmanager|google-analytics|plausible|segment\.io|hotjar|sentry/i);
  });

  test("outbound links are the two ledger explorers, opened safely", () => {
    const anchors = [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
    for (const anchor of anchors) {
      if (!/target="_blank"/.test(anchor)) continue;
      assert.match(anchor, /rel="[^"]*noopener[^"]*"/, `missing noopener: ${anchor}`);
      assert.match(anchor, /rel="[^"]*noreferrer[^"]*"/, `missing noreferrer: ${anchor}`);
    }
    // The hrefs themselves come from the evidence at runtime.
    assert.match(app, /link-mirror/);
    assert.match(app, /link-hashscan/);
    assert.match(app, /link-topic/);
    assert.equal(evidence.chain.mirror_url.startsWith("https://testnet.mirrornode.hedera.com/"), true);
    assert.equal(evidence.chain.hashscan_url.startsWith("https://hashscan.io/testnet/"), true);
  });

  test("nothing shipped carries key material or an internal path", () => {
    assert.doesNotMatch(shipped, /-----BEGIN[A-Z ]*PRIVATE KEY-----/);
    assert.doesNotMatch(shipped, /\b0x[0-9a-fA-F]{64}\b/);
    assert.doesNotMatch(shipped, /\/root\/|\/srv\/nomos\/|\/opt\/nomos-/);
    assert.doesNotMatch(shipped, /\.local\/[a-z-]+\.key/);
  });
});

describe("demo page — it refuses rather than half-renders", () => {
  test("the content is hidden until the evidence has been checked", () => {
    assert.match(html, /<main id="top" class="page" hidden>/);
    assert.match(app, /page\.hidden = true/);
    assert.match(app, /page\.hidden = false/);
  });

  test("the failure path is a real alert, not a silent empty page", () => {
    assert.match(html, /id="integrity-alert"[^>]*role="alert"/);
    assert.match(app, /integrityProblem/);
    assert.match(app, /MEMO|memo !== |memo and the quote id disagree/);
  });

  test("the browser-side gate re-checks the claims the page depends on", () => {
    assert.match(app, /data\.chain\.memo !== data\.chain\.quote_id/);
    assert.match(app, /data\.chain\.network !== "hedera:testnet"/);
    // Was: anchor_status !== "NOT_YET_ANCHORED", which refused to render a
    // confirmed anchor. The gate now checks that the signed receipt was not
    // edited, and that an anchor resolution is present at all.
    assert.match(app, /data\.receipt\.anchor !== null/);
    assert.match(app, /typeof data\.anchor\.state !== "string"/);
    assert.doesNotMatch(app, /anchor_status !== "NOT_YET_ANCHORED"/);
    assert.match(app, /mock_settlement !== false/);
  });

  test("a check that could not run draws no conclusion", () => {
    assert.match(app, /No conclusion is drawn from a check that did not run/);
    assert.match(jcsSource, /NO_WEBCRYPTO/);
  });

  test("scripting-off says so instead of showing an empty success", () => {
    assert.match(html, /<noscript>/);
    assert.match(html, /no claim is made/i);
  });
});

describe("demo page — bindings resolve against the evidence model", () => {
  const bindings = [...html.matchAll(/data-bind="([^"]+)"/g)].map((m) => m[1]);

  test("the page declares bindings at all", () => {
    assert.ok(bindings.length >= 10, `only ${bindings.length} bindings found`);
  });

  for (const path of [...new Set(bindings)]) {
    test(`data-bind="${path}" exists in the evidence`, () => {
      const value = get(evidence, path);
      assert.notEqual(value, undefined, `${path} is not in the evidence model`);
      assert.notEqual(value, null);
      assert.notEqual(String(value), "");
    });
  }

  test("every container the renderer fills is present in the markup", () => {
    for (const id of [
      "cards", "flow-steps", "fields", "matrix-body", "fc-points", "fc-log-body",
      "limits-list", "record-json", "link-mirror", "link-hashscan", "recompute",
      "recompute-out", "integrity-reason", "live", "foot-sources",
    ]) {
      assert.match(html, new RegExp(`id="${id}"`), `#${id} is missing from index.html`);
    }
  });

  test("no evidence value is hardcoded into the markup", () => {
    for (const value of [
      evidence.chain.transaction_id,
      evidence.chain.consensus_timestamp,
      evidence.receipt.receipt_id,
      evidence.receipt.record_digest,
      evidence.chain.payer,
      evidence.chain.payee,
      evidence.chain.payee_evm_alias,
    ]) {
      assert.doesNotMatch(
        html,
        new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
        `"${value}" is transcribed into index.html — it must come from the evidence module`,
      );
    }
    // The quote id is the one thing a reader is asked to compare, so check it
    // too: both sides of the comparison must be rendered, not typed.
    assert.doesNotMatch(html, new RegExp(evidence.chain.quote_id));
  });
});

describe("demo page — the browser canonicalizer agrees with the Node one", () => {
  let jcs: any;

  test("jcs.js loads and exposes the three functions the page uses", async () => {
    await import(join(REPO_ROOT, `${PUBLIC}/jcs.js`));
    jcs = (globalThis as Record<string, any>).NOMOS_JCS;
    assert.ok(jcs, "jcs.js did not install NOMOS_JCS");
    assert.equal(typeof jcs.canonicalString, "function");
    assert.equal(typeof jcs.canonicalDigest, "function");
    assert.equal(typeof jcs.receiptId, "function");
  });

  test("it canonicalizes the real receipt record byte for byte", () => {
    assert.equal(jcs.canonicalString(evidence.receipt.record), canonicalString(evidence.receipt.record));
  });

  test("it recomputes the digest the receipt carries", async () => {
    const digest = await jcs.canonicalDigest(evidence.receipt.record);
    assert.equal(digest, canonicalDigest(evidence.receipt.record));
    assert.equal(digest, evidence.receipt.record_digest);
  });

  test("it re-derives the receipt id the same way ids.ts does", async () => {
    const derived = await jcs.receiptId(
      evidence.receipt.record.idempotency_key,
      evidence.receipt.record.hedera_transaction_id,
      evidence.receipt.record_digest,
    );
    assert.equal(
      derived,
      receiptId(
        String(evidence.receipt.record.idempotency_key),
        String(evidence.receipt.record.hedera_transaction_id),
        evidence.receipt.record_digest,
      ),
    );
    assert.equal(derived, evidence.receipt.receipt_id);
  });

  test("the tamper probe the page runs really does change the digest", async () => {
    const tampered = JSON.parse(JSON.stringify(evidence.receipt.record));
    tampered.atomic_amount = "1";
    const digest = await jcs.canonicalDigest(tampered);
    assert.notEqual(digest, evidence.receipt.record_digest);
    assert.equal(digest, canonicalDigest(tampered));
  });

  test("it inherits both restrictions of the Node profile", () => {
    assert.throws(() => jcs.canonicalString({ amount: 0.05 }), /NON_INTEGER_NUMBER/);
    assert.throws(() => jcs.canonicalString({ a: undefined }), /UNDEFINED_VALUE/);
    assert.throws(() => jcs.canonicalString({ a: NaN }), /NON_FINITE_NUMBER/);
    assert.equal(jcs.canonicalString({ b: 1, a: 2 }), '{"a":2,"b":1}');
  });
});

describe("demo page — accessibility and responsiveness affordances", () => {
  test("the document declares a language, a viewport and a title", () => {
    assert.match(html, /<html lang="en">/);
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
    assert.match(html, /<title>[^<]{20,}<\/title>/);
  });

  test("there is exactly one h1", () => {
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
  });

  test("every image carries alternative text", () => {
    for (const img of html.match(/<img\b[^>]*>/g) ?? []) {
      assert.match(img, /\balt="[^"]{10,}"/, `image without useful alt text: ${img}`);
    }
  });

  test("decorative glyphs are hidden from assistive technology", () => {
    for (const svg of html.match(/<svg\b[^>]*>/g) ?? []) {
      assert.match(svg, /aria-hidden="true"/, `undecorated svg: ${svg}`);
    }
  });

  test("a skip link and a polite live region exist", () => {
    assert.match(html, /class="skip"/);
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /role="status"/);
  });

  test("copy controls are labelled for screen readers and report failure", () => {
    assert.match(app, /setAttribute\("aria-label", "Copy " \+ label\)/);
    assert.match(app, /Copying failed — select the value manually/);
  });

  test("reduced motion is honoured, and motion is one-shot in the first place", () => {
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(css, /@media \(prefers-reduced-motion: no-preference\)/);
    assert.match(app, /prefers-reduced-motion: reduce/);
    assert.doesNotMatch(css, /animation-iteration-count:\s*infinite/);
    assert.doesNotMatch(css, /\binfinite\b/);
  });

  test("long ledger identifiers are allowed to wrap instead of overflowing", () => {
    assert.match(css, /overflow-wrap:\s*anywhere/);
    assert.match(css, /word-break:\s*break-all/);
  });

  test("wide content scrolls inside its own box, not the page", () => {
    assert.match(css, /\.code\s*\{[^}]*overflow-x:\s*auto/s);
    assert.match(css, /overflow-x:\s*hidden/);
  });

  test("the layout has breakpoints for tablet and phone", () => {
    const widths = [...css.matchAll(/@media \(max-width: ([\d.]+)rem\)/g)].map((m) => Number(m[1]));
    assert.ok(widths.some((w) => w >= 60), `no desktop→tablet breakpoint in ${widths.join(", ")}`);
    assert.ok(widths.some((w) => w <= 46), `no phone breakpoint in ${widths.join(", ")}`);
  });

  test("focus is visible", () => {
    assert.match(css, /:focus-visible\s*\{[^}]*outline:/s);
  });
});

describe("demo page — the local preview server is read-only", () => {
  test("it serves the page and its assets", () => {
    assert.ok(resolveStaticPath("/")?.endsWith("index.html"));
    assert.ok(resolveStaticPath("/index.html"));
    assert.ok(resolveStaticPath("/styles.css"));
    assert.ok(resolveStaticPath("/evidence-data.js"));
    assert.ok(resolveStaticPath("/assets/nomosdemo.png"));
  });

  test("nothing outside the public directory is reachable", () => {
    // The property is containment, not a null return: a traversal that
    // normalises back inside the directory is harmless, one that escapes is not.
    for (const attempt of [
      "/../../.env",
      "/../../.local/hedera-payer.key",
      "/%2e%2e%2f%2e%2e%2f.env",
      "/..%2f..%2fpackage.json",
      "/../../../etc/passwd",
      "/assets/../../../package.json",
      "/\0",
      "/%",
    ]) {
      const resolved = resolveStaticPath(attempt);
      if (resolved === null) continue;
      assert.ok(
        resolved === PUBLIC_DIR || resolved.startsWith(PUBLIC_DIR + sep),
        `${attempt} escaped the public directory: ${resolved}`,
      );
    }
  });

  test("it serves only presentation file types", () => {
    assert.equal(resolveStaticPath("/build.ts"), null);
    assert.equal(resolveStaticPath("/key.pem"), null);
    assert.equal(resolveStaticPath("/notes.md"), null);
    assert.equal(resolveStaticPath("/package.json"), null);
    assert.equal(resolveStaticPath("/.env"), null);
  });

  test("it declares no write route", () => {
    const source = read("apps/demo-ui/serve.ts");
    assert.match(source, /req\.method !== "GET" && req\.method !== "HEAD"/);
    assert.match(source, /server\.listen\(port, HOST/);
    assert.match(source, /const HOST = "127\.0\.0\.1"/);
    assert.doesNotMatch(source, /writeFile|unlink|rename|mkdir\b/);
  });
});

describe("demo page — the architecture graphics", () => {
  /** file → [intrinsic width, intrinsic height]. Read from the files themselves. */
  const ASSETS: readonly (readonly [string, string])[] = [
    ["nomosdemo.png", "primary"],
    ["AgentNOMOS-12-Layer-Architecture-v1.png", "twelve-layer detail"],
  ];

  /** Intrinsic size straight out of the PNG IHDR — no image library needed. */
  function pngSize(rel: string): { width: number; height: number } {
    const bytes = readFileSync(join(REPO_ROOT, rel));
    assert.equal(bytes.subarray(1, 4).toString("ascii"), "PNG", `${rel} is not a PNG`);
    assert.equal(bytes.subarray(12, 16).toString("ascii"), "IHDR", `${rel} has no IHDR`);
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }

  for (const [asset, role] of ASSETS) {
    const rel = `${PUBLIC}/assets/${asset}`;
    const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    test(`the ${role} graphic exists on disk`, () => {
      const bytes = readFileSync(join(REPO_ROOT, rel));
      assert.ok(bytes.length > 1024, `${rel} is suspiciously small`);
    });

    test(`the ${role} graphic is referenced, with a named slot behind it`, () => {
      assert.match(html, new RegExp(`src="assets/${escaped}"`), `${asset} is not referenced`);
      assert.match(html, new RegExp(`data-asset-slot="${escaped}"`), `${asset} has no slot`);
      assert.match(html, new RegExp(`<strong>${escaped}</strong>`), `${asset}'s slot does not name it`);
    });

    test(`the ${role} graphic declares its true intrinsic size`, () => {
      const { width, height } = pngSize(rel);
      const tag = html.match(new RegExp(`<img src="assets/${escaped}"[^>]*>`))?.[0];
      assert.ok(tag, `no <img> for ${asset}`);
      assert.match(tag, new RegExp(`width="${width}"`), `declared width does not match the file (${width})`);
      assert.match(tag, new RegExp(`height="${height}"`), `declared height does not match the file (${height})`);
    });
  }

  test("the retired placeholder is referenced nowhere", () => {
    for (const source of [html, css, app, read("apps/demo-ui/README.md"), read(`${PUBLIC}/assets/README.md`)]) {
      assert.doesNotMatch(source, /1779269452389/, "the old placeholder filename is still referenced");
    }
  });

  test("every image lives below the fold, so lazy loading is right for all of them", () => {
    const imgs = html.match(/<img\b[^>]*>/g) ?? [];
    assert.equal(imgs.length, 2, "an image was added; re-check whether it is above the fold");
    for (const img of imgs) {
      assert.match(img, /loading="lazy"/, `${img} is not lazy`);
      assert.match(img, /decoding="async"/, `${img} blocks decode`);
    }
    // Both sit inside #architecture, which is the sixth section of eight.
    const architecture = html.slice(html.indexOf('<section id="architecture"'), html.indexOf('<section id="limits"'));
    assert.equal((architecture.match(/<img\b/g) ?? []).length, 2, "an image escaped the architecture section");
  });

  test("nothing crops or stretches a diagram", () => {
    assert.match(css, /\.figure-frame img\s*\{[^}]*height:\s*auto/s);
    assert.match(css, /\.figure-frame img\s*\{[^}]*object-fit:\s*contain/s);
    assert.match(css, /\.figure-frame img\s*\{[^}]*max-width:\s*100%/s);
    assert.doesNotMatch(css, /object-fit:\s*cover/);
  });

  test("a missing graphic degrades to the slot rather than a broken image", () => {
    assert.match(html, /Asset slot — image not present/);
    assert.match(html, /No substitute diagram has been invented/);
    assert.match(app, /wireAssetSlots/);
    assert.match(app, /naturalWidth === 0/);
    assert.match(app, /addEventListener\("error", showSlot\)/);
    // The slot is hidden in the markup and only revealed on failure, so a
    // present image never flashes a "missing" panel.
    assert.equal((html.match(/<div class="slot" hidden>/g) ?? []).length, 2);
  });

  test("the social preview points at the primary graphic, at its real size", () => {
    const { width, height } = pngSize(`${PUBLIC}/assets/nomosdemo.png`);
    assert.match(html, /<meta property="og:image" content="assets\/nomosdemo\.png">/);
    assert.match(html, /<meta name="twitter:image" content="assets\/nomosdemo\.png">/);
    assert.match(html, new RegExp(`<meta property="og:image:width" content="${width}">`));
    assert.match(html, new RegExp(`<meta property="og:image:height" content="${height}">`));
    assert.match(html, /<meta property="og:image:alt"/);
    assert.match(html, /<meta name="twitter:image:alt"/);
  });

  test("the twelve-layer material is named and described as AgentNOMOS", () => {
    const architecture = html.slice(html.indexOf('<section id="architecture"'), html.indexOf('<section id="limits"'));
    assert.match(architecture, /<summary>Technical architecture — the AgentNOMOS twelve layers<\/summary>/);
    assert.match(architecture, /<figcaption>\s*AgentNOMOS twelve-layer governance architecture \(detail view\)\./);
    assert.match(architecture, /alt="AgentNOMOS twelve-layer governance architecture/);
    assert.doesNotMatch(html, /NOMOS Protocol/i, "the retired NOMOS Protocol naming must not reappear");
  });

  test("each diagram can be opened at full size — they are dense on a phone", () => {
    for (const [asset] of ASSETS) {
      const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const link = html.match(new RegExp(`<a class="figure-link" href="assets/${escaped}"[^>]*>`))?.[0];
      assert.ok(link, `${asset} has no full-size link`);
      assert.match(link, /target="_blank"/);
      assert.match(link, /rel="noopener noreferrer"/);
      const { width, height } = pngSize(`${PUBLIC}/assets/${asset}`);
      const label = html.match(new RegExp(`href="assets/${escaped}"[^>]*>([^<]+)`))?.[1] ?? "";
      assert.match(label.replace(/&nbsp;/g, " "), new RegExp(`${width} × ${height}`), `the link mis-states the size of ${asset}`);
    }
  });

  test("alt text describes what is actually in each diagram", () => {
    const alts = [...html.matchAll(/<img\b[^>]*\balt="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(alts.length, 2);
    for (const alt of alts) {
      assert.ok(alt.length > 80, `alt text is too thin to replace the image: "${alt}"`);
      assert.doesNotMatch(alt, /^(image|diagram|graphic|picture) of/i, "alt text should not announce itself as an image");
    }
    // The layer names are the diagram's own content; a stale alt would drift.
    const detail = alts.find((a) => a.startsWith("AgentNOMOS"));
    assert.ok(detail);
    for (const layer of ["ATLAS", "AURUM", "LOGOS", "SCRIBE", "AEGIS", "MERCURY", "ARGUS", "ARCHON", "NOMOS", "AGORA", "FOEDUS", "ORBIS"]) {
      assert.match(detail, new RegExp(`\\b${layer}\\b`), `${layer} is missing from the detail alt text`);
    }
  });

  test("the twelve layers are presented as design, not as implemented or evidenced", () => {
    const architecture = html.slice(html.indexOf('<section id="architecture"'), html.indexOf('<section id="limits"'));
    assert.match(architecture, /no part of this page claims\s+they are implemented or exercised/);
    assert.doesNotMatch(architecture, /all twelve layers (are|were) (implemented|built|running|deployed)/i);
  });
});

describe("demo page — the artifacts it names are the ones that exist", () => {
  test("every source the footer lists is a real file", () => {
    for (const rel of evidence.sources) {
      assert.ok(readFileSync(join(REPO_ROOT, rel), "utf8").length > 0, `${rel} is empty or missing`);
    }
  });

  test("the verify command it prints is the documented one", () => {
    assert.match(evidence.receipt.verify_command, /^node tools\/verify-receipt\.ts docs\/evidence\/cp-h2\/receipt\.json/);
    assert.match(evidence.receipt.verify_command, new RegExp(evidence.receipt.signature.kid));
    assert.match(evidence.receipt.verify_command, new RegExp(evidence.receipt.signature.public_key_hex));
    assert.match(read(EVIDENCE_SOURCES.report), /node tools\/verify-receipt\.ts docs\/evidence\/cp-h2\/receipt\.json/);
  });
});
