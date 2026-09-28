# Porting notes

The wire specification is `docs/WIRE.md` in signet-contacts. This file lists
the places where a straightforward port in another language produces
different bytes or different accept/reject decisions from the TypeScript
reference, found while writing the Kotlin port. Each one has vectors here.

## JSON is JavaScript's JSON

Every digest on this wire is SHA-256 over `JSON.stringify` output, and every
parser mirrors what `JSON.parse` returns. Most JSON libraries disagree with
both in small ways.

- **Numbers are doubles.** `2`, `2.0` and `2e0` are the same value, so
  `{"v":2.0}` is a valid v2 message. An integer above 2^53 has already been
  rounded by the time a JavaScript parser sees it.
- **Number output is ECMA-262 `Number::toString`:** the shortest decimal that
  round-trips, with an exponent only at or above `1e21` or below `1e-6`
  (`1e+21`, `1.5e-7`, `123456789012345680000`, `5e-324`). Java's
  `Double.toString` is not shortest in every case.
- **String escaping is exactly** `"`, `\`, `\b \f \n \r \t`, the other C0
  controls as lowercase `\u00xx`, and lone surrogates as `\udxxx`. Nothing
  else: not `/`, not U+2028, not non-ASCII.
- **Duplicate keys:** the last value wins, at the first key's position.
- **Canonical key order** is the order the reference's parser constructs each
  object in, which is what every hash is taken over. Hash a message by parsing
  it and serialising the parsed form, never by serialising the caller's object.

`cases/stringify.json` covers all of this.

## Text

- **UTF-8 encoding** of a string with a lone surrogate writes U+FFFD
  (`EF BF BD`), as `TextEncoder` does. Some runtimes write `?`.
- **`trim()`** removes ECMA-262 WhiteSpace and LineTerminator: including
  U+FEFF, U+00A0, U+1680, U+2000-200A, U+2028/2029, U+202F, U+205F, U+3000,
  and excluding U+001C-001F. That is not the same set as Java's or Python's
  default whitespace.
- **Length caps** are in UTF-16 code units wherever the reference uses
  `.length` (relay URLs, invite captions, the pairing URI), and in code points
  wherever it slices with `Array.from` (`sanitizeWireText`).

## Integers

The reference checks most integer fields with `Number.isInteger(v) && v >= 0`,
which accepts `1e300`. The Kotlin port requires a safe integer (at most
2^53 - 1) wherever it needs a 64-bit integer, so it rejects values the
reference accepts only above 2^53. No vector exercises that range; a port may
do either, but should say which.

## Pairing URIs

The query is `application/x-www-form-urlencoded` as `URLSearchParams` handles
it: `+` is a space, a `%` not followed by two hex digits is literal, invalid
UTF-8 decodes to U+FFFD, a leading BOM in a value is kept, and the first
occurrence of a repeated parameter wins. `t` goes through JavaScript's
`Number()`, which accepts surrounding whitespace, `1.7e9`, `0x...` and the
empty string (as 0); a missing `t` is 0 and fails the freshness check.

## Relay URLs in invites

Invite relays are normalised with the WHATWG URL parser (`new URL(raw).href`)
and deduplicated, and the normalised strings are hashed into every contact
exchange transcript. A port must reproduce the WHATWG parser for `wss:` URLs:
scheme case, `\` as `/`, default port removal, IPv4 in hex, octal and short
forms, IPv6 compression, IDNA, dot segments, and the path, query and fragment
percent-encode sets.

The path percent-encode set changed in the URL Standard: Node 24 encodes `^`
in a path and Node 22 does not. The reference therefore produces different
transcript hashes for such a relay depending on the runtime it runs on. The
vectors follow the current standard (Node 24). Relays with `^` in their path
are unlikely in practice, but a producer and consumer on different runtimes
would disagree about them.

### IDNA

WHATWG's domain-to-ASCII is UTS #46 with `Transitional_Processing=false`,
`CheckHyphens=false`, `CheckBidi=true`, `CheckJoiners=true`,
`UseSTD3ASCIIRules=false`, `VerifyDnsLength=false`. An `xn--` label must
decode as valid RFC 3492 Punycode and re-validate; a label that fails, or
that decodes to all-ASCII, fails the whole URL.

IDNA 2003 implementations (`java.net.IDN`, Python's `encodings.idna`) agree
with this for ordinary hosts, but differ on the four deviation characters
(U+00DF, U+03C2, U+200C, U+200D) and on code points unassigned in Unicode 3.2
(for example U+1E9E). A port without UTS #46 must fail closed on those
inputs rather than produce a different hash; the reference accepts some of
them, so such a port must carry an explicit divergence list in its
conformance test. In `invite.json`, the cases `relay "wss://faß.de/"`,
`relay "wss://ς.example/"`, `relay "wss://ẞ.example/"` and
`relay "wss://%C3%9F.example/"` exercise this.

Java's `IDN.toUnicode` never throws, so it cannot be used to validate
`xn--` labels; a real Punycode decoder is needed.

## Nostr

NIP-44 here is v2 with plaintext capped at 65535 bytes. Recent nostr-tools
releases accept larger plaintexts; nothing on this wire seals more than
`MAX_WIRE_BYTES` (65532) through NIP-44 directly, so the cap never binds.

## Relay adapters and client lifecycle

These are requirements the vectors cannot capture, because they are about
the runtime shape of a relay adapter and the client's lifecycle rather than
about the bytes of a single message.

A relay adapter must verify every event's signature before the event can
influence newest-selection or pagination. Without this a hostile relay
forges an event with a far-future `created_at` that wins fetch-newest and
hides an honest relay's newer projection, including a block or revocation;
the client's decrypt then fails and reads as "nothing found". The reference
gets this from nostr-tools' verifying pool; the `RelayIo` contract requires
it of every adapter.

Revocation and state listeners must be invoked after the ingest lock is
released, never while it is held, and on no particular thread; a listener
that re-enters the client must not deadlock.

Stopping the client must not leave a half-committed state: once an ingest
commits in memory it must also finish its storage writes and fire its
listeners, or commit nothing. In Kotlin this is a final cancellation check
followed by a non-cancellable commit block.

Pairing deadlines are elapsed time; use a monotonic clock where the platform
has one. The reference uses `Date.now()`, listed under findings in
`NEXT-STEPS.md`.
