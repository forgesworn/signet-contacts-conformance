# Next steps

Written 2026-09-28, the day the conformance repository and the Kotlin port went
public. It records where things stand, what has not been exercised yet, and the
decisions still open.

## Where things stand

| Repository | State |
| --- | --- |
| `forgesworn/signet-contacts` | TypeScript reference, 0.1.0, not on npm, no tags. Runs `conformance.yml` since pull request #5. |
| `forgesworn/signet-contacts-conformance` | Vectors generated from reference `fbb13cd` on Node 24.21.0. No tags; ports test against `main`. |
| `forgesworn/signet-contacts-kotlin` | Port at 0.1.0: core 316 tests, nostr 8, all vectors passing. Not published; CI pinned to a conformance commit, bumped by hand after each vector change, with a scheduled drift job against its `main`. |

CI is green on `main` in all three.

### Sync chain, as verified

| Step | Verified |
| --- | --- |
| push to signet-contacts `main` dispatches `sync.yml` here | yes, by the merge of signet-contacts #5 |
| `sync.yml` regenerates and finds nothing to do | yes |
| `sync.yml` opens a pull request when a vector changes | **no**, see below |
| `notify-ports.yml` dispatches the Kotlin CI | yes, by a manual run |
| the Kotlin CI fails on a mismatch | by construction: a missing or differing vector fails the build |

## Not yet exercised

**The sync pull request.** `sync.yml` pushes `sync/signet-contacts` and opens
the pull request with `PORTS_DISPATCH_TOKEN`, so that CI runs on it. The first
real vector change will be its first run. To test it sooner: push a branch
with one vector made stale (the local pre-push hook refuses this, rightly, so
it needs an explicit decision to skip the hook), run `sync.yml` on that branch
by hand, check the pull request opens and CI runs on it, then close it and
delete both branches.

## Decisions open

1. **Kotlin release.** Options, cheapest first: a `v0.1.0` tag and a GitHub
   release, with consumers pinning to the tag; JitPack, which builds from a
   tag with no further setup; Maven Central, which needs the `dev.forgesworn`
   namespace verified, a signing key and publishing credentials.
2. **signet-contacts on npm.** Through the anvil trusted-publishing pipeline
   only, if and when wanted.
3. **Conformance tags.** Ports follow `main`. Tagging releases of the vectors
   would let a port pin to a known set while still getting nightly warnings
   from `main`.

## Findings in the reference

None of these are fixed. Each is either recorded in the vectors or documented
as a port divergence.

- **Runtime-dependent hashes.** Invite relay URLs are normalised with the
  WHATWG URL parser and hashed. Node 22 and Node 24 disagree on `^` in a path,
  so a producer and consumer on different runtimes would compute different
  contact-exchange hashes for such a relay. Unlikely in practice. The reference
  could refuse `^` in relay paths, or pin its own normalisation.
- **Upstream `malformed` vectors.** They carry no expected result, and two
  entries parse: an unknown `ownerPubkey` is dropped, and a short
  `operationId` yields an empty batch. `vectors/cases/upstream-malformed.json`
  records the actual outcomes. Worth either adding expectations upstream or
  renaming the arrays.
- **`checks[].method` accepts an array.** `["words"]` passes because the check
  stringifies it, and it is stored as the array. The Kotlin port requires a
  string.
- **Non-safe integers.** `Number.isInteger` accepts `1e300`; the Kotlin port
  requires at most 2^53 - 1.
- **The signet-contacts README says the repository is private.** It is public.
  The install section still describes a private-repository install.
- **Wall-clock elapsed time.** `Date.now()` is used for pairing deadlines and
  live-gap checks, so a clock change distorts them; a monotonic source would
  be safer.
- **Signature verification is implicit.** The reference relies on
  nostr-tools' `SimplePool` default verification and the `RelayIo` contract
  text; no test enforces that an adapter verifies, and a custom adapter that
  skips it is silently unsafe (see PORTING.md, "Relay adapters and client
  lifecycle").

## Kotlin port divergences to revisit

- Non-ASCII relay hosts go through `java.net.IDN` (IDNA 2003), which agrees
  with UTS #46 for ordinary hosts. The four deviation characters (U+00DF,
  U+03C2, U+200C, U+200D) and code points unassigned in Unicode 3.2 are
  rejected (fail closed) where the reference accepts them. `xn--` labels are
  validated with an RFC 3492 decoder on both paths. `invite.json` carries
  these as known divergences: `relay "wss://faß.de/"`,
  `relay "wss://ς.example/"`, `relay "wss://ẞ.example/"` and
  `relay "wss://%C3%9F.example/"`. On Android, `android.icu.text.IDNA` (API
  24 and up) implements UTS #46 and could replace `java.net.IDN` there.

## Token upkeep

One fine-grained token backs both `CONFORMANCE_DISPATCH_TOKEN` (in
signet-contacts) and `PORTS_DISPATCH_TOKEN` (here). It needs Contents read and
write on `signet-contacts-conformance` and `signet-contacts-kotlin`, and Pull
requests read and write on `signet-contacts-conformance`. When it expires,
renew it and set both secrets again. Until then the nightly schedules keep
everything converging, but sync pull requests fall back to `GITHUB_TOKEN`,
which cannot open them in this repository.

## Adding a port

Add its repository to `matrix.port` in `.github/workflows/notify-ports.yml`,
give it a CI job that checks this repository out and fails on any mismatch, and
widen the token's repository access to include it.
