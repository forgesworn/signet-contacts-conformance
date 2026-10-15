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
| `docs/NEXT-STEPS.md` | Current state, open decisions and findings in the reference. |

### Upstream vectors

| File | Covers |
| --- | --- |
| `pairing.v2.json` | the pairing URI (byte exact), its parse (`parsePairingRequestV2`), the ack (byte exact, parsed by `parsePairingAckV2`) and the three routing tags (`projectionTag`, `proposalTag` and the ack tag) |
| `projection.v2.json` | full, blocks-only, truncated and revoked projections (byte exact), and projections carrying uncovered fields, which must be refused |
| `proposal.v1.json` | a proposal batch (byte exact) |
| `envelope.v2.json` | a vault envelope sealed with real NIP-44 under fixed randomness (byte exact) |
| `sanitise.json` | `sanitizeWireText`: the one text sanitiser, as `input` and `output` pairs with a shared `maxLen` |
| `pairing-code.json` | `pairingCode`: the six-digit pairing code |
| `contact-invite-v1.json` | a full contact-exchange transcript, its hashes and the words each side says |
| `channel-check-v1.json` | the channel-check transcript and words |

The `v1` in `proposal.v1.json`, `contact-invite-v1.json` and `channel-check-v1.json`
is the format version of those messages (their bodies carry `"v": 1`), not a
legacy marker. All eight files listed here are current. The `.v1` and `-v1`
spellings are upstream's file names, copied verbatim. The legacy v1 inputs are
the ones the reference refuses: the v1 ack (`ack.v1Plaintext` in
`pairing.v2.json`, the "v1 ack" case in `cases/ack.json`), a `v=1` pairing URI
(`cases/pairing-uri.json`) and a `v: 1` vault envelope
(`cases/envelope-parse.json`). `contact-invite-v1.json` calls itself an
"unreleased v1 draft" in its own `note`.

The upstream `malformed` arrays do not record an expected result, and not all
of them are refused (an unknown field is dropped; a bad proposal inside a
batch is dropped). `cases/upstream-malformed.json` records what the reference
returns for each.

### Generated cases

The second column is the reference call each case exercises. Its argument names
are the keys of the case, or of the top level of the file, that supply them.

| File | Reference call | Covers |
| --- | --- | --- |
| `relay-url.json` | `isValidContactsRelayUrl(input)` | which rendezvous relay URLs are accepted |
| `pairing-uri.json` | `parsePairingRequestV2(input, { nowSec })` | URI parsing: versions, timestamps in every form `Number()` accepts, challenge case, capability tokens, directory, app-name sanitising and truncation, form-encoding quirks, the length cap |
| `ack.json` | `parsePairingAckV2(plaintext, expectedChallenge)` | ack parsing: version, byte-exact challenge, duplicate keys, capability narrowing, staleness clamping |
| `projection-parse.json` | `parseProjection(plaintext)` | projection parsing: item-level drops, caps, sanitising, duplicate ids, field coverage refusals, frontier validation, the 2000-contact cap |
| `projection-build.json` | `buildProjection(input)`, where `input` is the result of `parseProjection` | byte exact: key order and string escaping |
| `proposal-parse.json` | `parseProposalBatch(plaintext)` | proposal batches |
| `invite.json` | `parseContactInvite(raw, now)` | contact invites, including WHATWG URL normalisation of relay URLs (IPv4 forms, IPv6, IDNA, percent-encoding, dot segments, default ports) |
| `contact-exchange.json` | `parseContactExchangeMessage(raw)`, then `contactMessageHash(expected)` | exchange messages and their transcript hashes |
| `stringify.json` | `JSON.stringify(JSON.parse(input))` | number formatting, escaping, duplicate keys |
| `envelope-parse.json` | `parseVaultEnvelope(content)` | vault-envelope framing |
| `state.json` | `emptyContactsState()`, then `applyProjection(state, projection, nowSec)`, `isFresh(state, nowSec)` and `visibleContacts(state)` for each step | a sequence: frontier ordering, revocation, sticky blocks |
| `app-invite.json` | `parseAppInviteRequest(json, now)` and `parseAppInviteReply(json, request, now)` | app-introduction requests and replies |
| `nostr.json` | none: these are nostr-tools results, not reference calls | NIP-01 event ids and signatures, NIP-44 v2 conversation keys and payloads at every padding boundary |
| `upstream-malformed.json` | `parseProjection(plaintext)` and `parseProposalBatch(plaintext)` | what the reference returns for the upstream `malformed` and `uncovered` inputs |

Every file uses `\uXXXX` escapes for anything outside printable ASCII, so no
invisible character can hide in a diff.

## Vector format

The upstream files in `vectors/*.json` each have their own shape, which their
`description` and the table above explain. The generated files in
`vectors/cases/*.json` share one, described here.

A case file has a `description` (naming the reference function and what must
match), any shared fixtures the function needs at the top level (`nowSec`,
`now` or `expectedChallenge`), and a `cases` array. Each case has a `name`, its
input under a key that depends on the file (`plaintext`, `input`, `raw`,
`content`), and `expected`. This is `ack.json`, abridged:

```json
{
  "description": "parsePairingAckV2(plaintext, expectedChallenge): the parsed ack or null.",
  "expectedChallenge": "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
  "cases": [
    {
      "name": "baseline",
      "plaintext": "{\"v\":2,\"grantId\":\"ffff...\",...}",
      "expected": { "v": 2, "grantId": "ffff...", "...": "..." }
    },
    {
      "name": "v1 ack",
      "plaintext": "{\"v\":1,...}",
      "expected": null
    }
  ]
}
```

**Refusals.** When the reference refuses an input, `expected` is `null`, and
`hash` is `null` too in `contact-exchange.json`. `pairing-uri.json` differs:
`expected` is `{ "request": ..., "warnings": [...] }`, a refusal is
`"request": null`, and `warnings` lists the reason codes in order (for example
`"bad-version"`). A request can parse and still carry warnings.

**Files that do not follow the `cases` shape:**

| File | Shape |
| --- | --- |
| `relay-url.json` | each case has `input` and `valid` (a boolean), with no `name` and no `expected` |
| `stringify.json` | each case has `input` and `output`, with no `name` and no `expected` |
| `projection-build.json` | each case has `input` (a parsed projection) and `built`, which is `{ "value": "<string>" }` or `{ "throws": true }` if the builder throws. No current case throws |
| `contact-exchange.json` | each case has `raw`, `expected` and `hash` (`contactMessageHash` of `expected`, or `null`) |
| `state.json` | `steps` instead of `cases`. Start from `emptyContactsState()`, apply each step's `projection` at its `nowSec`, carry the state forward, and after every step compare `accepted` (false when the state came back unchanged), `state`, `fresh` and `visible` (the contact ids `visibleContacts` returns, in its order) |
| `app-invite.json` | `requests` (each `json`, `now`, `expected`) and `replies` (each `request`, `json`, `now`, `expected`), where a reply's `request` is the parsed request passed as the second argument |
| `upstream-malformed.json` | `projection` and `proposal` arrays of `plaintext` and `expected`, with no `name` |
| `nostr.json` | no `cases`. `events` are signed NIP-01 events whose `id` and `sig` must verify. `nip44.conversationKey` is the conversation key of `secretKeys.sk1` and `publicKeys.pk2`, and each of `nip44.payloads` (and `nip44.unicode`) is the `payload` that NIP-44 v2 produces for its `plaintext` under that key and the fixed `nip44.nonce`. Test keys only |

**Byte exact.** Nothing in a file flags a value as byte exact. Where a
serialised string has to match character for character (a built projection, a
URI, an ack, a sealed envelope), the table of upstream vectors above says
"byte exact", or the file's own `description` says "byte for byte" or "exactly"
(`projection-build.json`, `pairing-code.json`, `sanitise.json`, `invite.json`).
Compare everything else, that is parsed objects, structurally: key order does
not matter.

**`manifest.json`** has four keys:

```json
{
  "description": "Provenance for every vector file. ...",
  "reference": { "package": "@forgesworn/signet-contacts", "version": "0.1.0", "commit": "<git SHA of the reference>" },
  "generator": { "node": "v24.21.0" },
  "files": { "vectors/pairing.v2.json": "<SHA-256 of the file, lower-case hex>", "...": "..." }
}
```

`files` has one entry for every JSON file in `vectors/` and `vectors/cases/`
except `manifest.json`. `reference` and `generator` are kept as they were
unless the reference's version or a file hash changes, so they say which
reference and Node version last changed a vector. `commit` is `"unknown"` when
the reference was not a git checkout.

## Using the vectors

Not published to npm. Clone beside your port:
`git clone https://github.com/forgesworn/signet-contacts-conformance`.

This loads `ack.json` and checks every case. `parsePairingAckV2` is the
reference's name; here it stands for your port's parser with its result
converted to a `JsonElement` (`JsonNull` for a refusal), which you write.

```kotlin
import java.io.File
import kotlin.test.assertEquals
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// Your port's ack parser, with its result serialised to JSON (JsonNull for a refusal).
fun parsePairingAckV2(plaintext: String, expectedChallenge: String): JsonElement = TODO()

fun ackVectors() {
    val file = Json.parseToJsonElement(File("vectors/cases/ack.json").readText()).jsonObject
    val challenge = file["expectedChallenge"]!!.jsonPrimitive.content
    for (case in file["cases"]!!.jsonArray) {
        val c = case.jsonObject
        val plaintext = c["plaintext"]!!.jsonPrimitive.content
        assertEquals(c["expected"]!!, parsePairingAckV2(plaintext, challenge), c["name"]!!.jsonPrimitive.content)
    }
}
```

`challenge` is the file's top-level `expectedChallenge`, the same for every
case. `JsonObject` equality ignores key order, which is the structural
comparison described under "Byte exact" above.

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
with Contents read and write on its target. `sync.yml` also pushes and opens
its pull request with `PORTS_DISPATCH_TOKEN`, so that token needs Pull requests
read and write on this repository too; a pull request opened with
`GITHUB_TOKEN` would get no CI. Without the dispatch tokens everything still
converges on the nightly schedules.

## Regenerating

`scripts/generate.mjs` loads the TypeScript reference from a built checkout of
`signet-contacts`. It looks for `../signet-contacts`, a directory of exactly
that name beside this one, unless the `SIGNET_CONTACTS_DIR` environment variable
names another path. The checkout needs `dist/index.js`, so build it first. It
also needs its own `node_modules` (`nostr.json` takes nostr-tools and
`@noble/curves` from there), `vectors/` and `package.json`.

```bash
# in a checkout of signet-contacts, at ../signet-contacts
npm ci && npm run build
# here
npm run generate   # rewrite vectors/
npm run check      # fail if anything would change; writes nothing

# a checkout somewhere else
SIGNET_CONTACTS_DIR=<dir> npm run check
```

`npm run check` needs the same checkout as `npm run generate`: it rebuilds every
case from the reference, compares the result with the files here, and compares
the reference's own `vectors/*.json` with the copies here. It passes only against
the reference commit the vectors came from (`reference.commit` in
`manifest.json`) or one that changes no vector. This repository has no other
test script.

Generate with **Node 24**. The invite relay cases depend on the runtime's WHATWG
URL implementation, and Node 22 percent-encodes `^` in a URL path differently
(see `docs/PORTING.md`). CI pins Node 24.

## Adding a port

Add its repository to the `matrix.port` list in
`.github/workflows/notify-ports.yml`, and give it a CI job that checks this
repository out and fails on any mismatch.

## Licence

MIT.
