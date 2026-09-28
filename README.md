# signet-contacts-conformance

Language-neutral conformance vectors for the
[signet-contacts](https://github.com/forgesworn/signet-contacts) v2 wire:
capability-scoped pairing, per-grant encrypted projections, proposals, contact
exchange and app introductions.

If you are porting signet-contacts to another language, run these in your test
suite and fail the build on any mismatch. They are plain JSON, so any language
can load them.

## Layout

| Path | What it is |
| --- | --- |
| `vectors/*.json` | The reference's own frozen vectors, copied verbatim from `signet-contacts/vectors`. |
| `vectors/cases/*.json` | Edge cases generated from the reference by `scripts/generate.mjs`. Each records an input and exactly what the TypeScript reference returns for it. |
| `vectors/manifest.json` | The reference commit and version the files came from, the Node version that generated them, and a SHA-256 of every file. |
| `docs/PORTING.md` | The places a port most often diverges without noticing, and how to get them right. |

### Upstream vectors

| File | Covers |
| --- | --- |
| `pairing.v2.json` | the pairing URI (byte exact), its parse, the ack (byte exact) and the three routing tags |
| `projection.v2.json` | full, blocks-only, truncated and revoked projections (byte exact), and projections carrying uncovered fields, which must be refused |
| `proposal.v1.json` | a proposal batch (byte exact) |
| `envelope.v2.json` | a vault envelope sealed with real NIP-44 under fixed randomness (byte exact) |
| `sanitise.json` | the one text sanitiser |
| `pairing-code.json` | the six-digit pairing code |
| `contact-invite-v1.json` | a full contact-exchange transcript, its hashes and the words each side says |
| `channel-check-v1.json` | the channel-check transcript and words |

The upstream `malformed` arrays do not record an expected result, and not all
of them are refused (an unknown field is dropped; a bad proposal inside a
batch is dropped). `cases/upstream-malformed.json` records what the reference
returns for each.

### Generated cases

| File | Covers |
| --- | --- |
| `relay-url.json` | which rendezvous relay URLs are accepted |
| `pairing-uri.json` | URI parsing: versions, timestamps in every form `Number()` accepts, challenge case, capability tokens, directory, app-name sanitising and truncation, form-encoding quirks, the length cap |
| `ack.json` | ack parsing: version, byte-exact challenge, duplicate keys, capability narrowing, staleness clamping |
| `projection-parse.json` | projection parsing: item-level drops, caps, sanitising, duplicate ids, field coverage refusals, frontier validation, the 2000-contact cap |
| `projection-build.json` | `buildProjection(parseProjection(x))`, byte exact: key order and string escaping |
| `proposal-parse.json` | proposal batches |
| `invite.json` | contact invites, including WHATWG URL normalisation of relay URLs (IPv4 forms, IPv6, IDNA, percent-encoding, dot segments, default ports) |
| `contact-exchange.json` | exchange messages and their transcript hashes |
| `stringify.json` | `JSON.stringify(JSON.parse(x))`: number formatting, escaping, duplicate keys |
| `envelope-parse.json` | vault-envelope framing |
| `state.json` | `applyProjection` over a sequence: frontier ordering, revocation, sticky blocks |
| `app-invite.json` | app-introduction requests and replies |
| `nostr.json` | NIP-01 event ids and signatures, NIP-44 v2 conversation keys and payloads at every padding boundary, from nostr-tools |

Every file uses `\uXXXX` escapes for anything outside printable ASCII, so no
invisible character can hide in a diff.

## Using the vectors

```kotlin
val cases = Json.parse(File("vectors/cases/ack.json").readText())["cases"]
for (c in cases) assertEquals(c["expected"], parsePairingAckV2(c["plaintext"], challenge)?.toJson())
```

Compare parsed values structurally (key order does not matter), except where a
file says "byte exact": those strings must match exactly.

Check out this repository beside your port and point your tests at
`vectors/`. `forgesworn/signet-contacts-kotlin` does it with a Gradle property
(`-PsignetContactsVectors=<dir>`) and treats a missing checkout as a failure,
not a skip.

## Keeping in sync

```
signet-contacts (main)
  └─ push ──► conformance: sync.yml regenerates, opens a "sync" pull request
                └─ merge ──► conformance: notify-ports.yml dispatches every port
                               └─► port CI runs every vector; a mismatch fails it
```

- **`signet-contacts`** runs `conformance.yml`. On a pull request it reports
  whether the branch changes these vectors (a warning, not a block, since this
  repository can only follow once the change is on main). On main it
  dispatches `sync.yml` here.
- **This repository** runs `ci.yml` on every push, pull request and nightly: it
  rebuilds the reference from `signet-contacts` main and fails if any vector
  differs. `sync.yml` regenerates and opens or refreshes the
  `sync/signet-contacts` pull request. `notify-ports.yml` tells each port when
  `vectors/` changes on main.
- **Each port** runs its conformance tests against this repository's main on
  every push, pull request, nightly, and on dispatch.

Cross-repository dispatch needs two secrets: `CONFORMANCE_DISPATCH_TOKEN` in
`signet-contacts` and `PORTS_DISPATCH_TOKEN` here, each a fine-grained token
allowed to send `repository_dispatch` to the target. Without them everything
still converges on the nightly schedules.

## Regenerating

```bash
# in a checkout of signet-contacts, beside this one
npm ci && npm run build
# here
npm run generate   # or: npm run check
```

Generate with **Node 24**. The invite relay cases depend on the runtime's WHATWG
URL implementation, and Node 22 percent-encodes `^` in a URL path differently
(see `docs/PORTING.md`). CI pins Node 24.

## Adding a port

Add its repository to the `matrix.port` list in
`.github/workflows/notify-ports.yml`, and give it a CI job that checks this
repository out and fails on any mismatch.

## Licence

MIT.
