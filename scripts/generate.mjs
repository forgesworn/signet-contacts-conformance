// Regenerates vectors/cases/*.json from the TypeScript reference implementation,
// and vectors/manifest.json. The upstream frozen vectors (vectors/*.json) are
// copied verbatim from the reference repository by `sync`.
//
//   node scripts/generate.mjs            write everything
//   node scripts/generate.mjs --check    fail if anything would change
//
// SIGNET_CONTACTS_DIR points at a built checkout of forgesworn/signet-contacts
// (default: ../signet-contacts). Run `npm ci && npm run build` there first.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const refDir = resolve(process.env.SIGNET_CONTACTS_DIR ?? join(root, '..', 'signet-contacts'));
const CHECK = process.argv.includes('--check');
const ref = await import(pathToFileURL(join(refDir, 'dist', 'index.js')).href);

const failures = [];

/** Same escaping the reference uses for its own frozen files: every character
 *  outside printable ASCII becomes a \u escape, so nothing invisible hides in a diff. */
function escapeNonAscii(json) {
  let out = '';
  for (let i = 0; i < json.length; i++) {
    const code = json.charCodeAt(i);
    const literal = (code >= 0x20 && code <= 0x7e) || code === 0x09 || code === 0x0a || code === 0x0d;
    out += literal ? json[i] : `\\u${code.toString(16).padStart(4, '0')}`;
  }
  return out;
}

function emit(path, value) {
  const json = `${escapeNonAscii(JSON.stringify(value, null, 2))}\n`;
  const full = join(root, path);
  if (CHECK) {
    if (!existsSync(full) || readFileSync(full, 'utf8') !== json) failures.push(path);
    return;
  }
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, json, 'utf8');
}

/** Run `fn`, recording a throw as `{ throws: true }` rather than a value. */
function outcome(fn) {
  try { return { value: fn() ?? null }; } catch { return { throws: true }; }
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------
const NOW = 1_700_000_000;
const APP = 'a'.repeat(64);
const GRANT = 'f'.repeat(32);
const CHALLENGE = 'D'.repeat(32);
const DEVICE = '2'.repeat(32);
const HEX = (c, n) => c.repeat(n);

// ---------------------------------------------------------------------------
// relay-url.json
// ---------------------------------------------------------------------------
{
  const inputs = [
    'wss://relay.example.com', 'WSS://Relay.Example.com', 'wss://', 'wss:relay', 'ws://localhost',
    'ws://localhost:7777', 'ws://LOCALHOST/', 'ws://127.0.0.1', 'ws://127.0.0.1:1/x', 'ws://localhost.evil.com',
    'ws://127.0.0.1.evil', 'ws://localhostx', 'ws://example.com', 'https://relay.example.com', '',
    ' wss://relay.example.com', `wss://${'a'.repeat(250)}`, `wss://${'a'.repeat(251)}`,
    'ws://localhost\n', 'ws://127.0.0.1\n', 'wss://relay.example.com\n',
  ];
  emit('vectors/cases/relay-url.json', {
    description: 'isValidContactsRelayUrl: wss:// only, ws:// only to loopback, at most MAX_RELAY_LEN (256) UTF-16 units.',
    cases: inputs.map((input) => ({ input, valid: ref.isValidContactsRelayUrl(input) })),
  });
}

// ---------------------------------------------------------------------------
// pairing-uri.json
// ---------------------------------------------------------------------------
{
  const base = ref.buildPairingUriV2({
    appPubkey: APP, appName: 'Flock', capabilities: ['signet.contacts.read:directory', 'signet.contacts.blocks.read'],
    directory: 'owner', relay: 'wss://relay.example.com', nowSec: NOW, challenge: CHALLENGE,
  });
  const q = base.slice(base.indexOf('?') + 1);
  const withParam = (name, value) => {
    const p = new URLSearchParams(q);
    if (value === undefined) p.delete(name); else p.set(name, value);
    return `signet-grant://pair?${p.toString()}`;
  };
  const raw = (query) => `signet-grant://pair?${query}`;
  const all15 = ref.CAPABILITIES.join(',');
  const cases = [
    ['baseline', base],
    ['bare query string, no scheme', q],
    ['v=1 is refused', withParam('v', '1')],
    ['missing v', withParam('v', undefined)],
    ['first v wins', raw(`v=2&v=1&${q.replace('v=2&', '')}`)],
    ['uppercase app pubkey is lowercased', withParam('app', 'A'.repeat(64))],
    ['short app pubkey', withParam('app', 'a'.repeat(63))],
    ['plaintext relay', withParam('relay', 'ws://relay.example.com')],
    ['loopback relay', withParam('relay', 'ws://localhost:7777')],
    ['stale t', withParam('t', String(NOW - 301))],
    ['t at the edge', withParam('t', String(NOW + 300))],
    ['t with whitespace', withParam('t', ` ${NOW} `)],
    ['t in exponent form', withParam('t', '1.7e9')],
    ['t in hex', withParam('t', `0x${NOW.toString(16)}`)],
    ['t fractional', withParam('t', `${NOW}.5`)],
    ['t missing', withParam('t', undefined)],
    ['t empty', withParam('t', '')],
    ['t negative', withParam('t', '-1')],
    ['lowercase challenge is kept verbatim', withParam('challenge', 'd'.repeat(32))],
    ['mixed-case challenge is kept verbatim', withParam('challenge', 'dD'.repeat(16))],
    ['31-char challenge', withParam('challenge', 'd'.repeat(31))],
    ['non-hex challenge', withParam('challenge', 'g'.repeat(32))],
    ['unknown capability token is dropped', withParam('caps', 'signet.contacts.read:directory,signet.contacts.read:avatar')],
    ['only unknown tokens', withParam('caps', 'signet.contacts.read:avatar')],
    ['caps with spaces and empties', withParam('caps', ' signet.contacts.blocks.read , ,signet.contacts.read:directory ')],
    ['caps out of order and duplicated', withParam('caps', 'signet.contacts.blocks.read,signet.contacts.read:directory,signet.contacts.blocks.read')],
    ['all fifteen capabilities', withParam('caps', all15)],
    ['seventeen tokens truncate', withParam('caps', `${all15},signet.contacts.read:directory,signet.contacts.blocks.read`)],
    ['missing dir defaults to owner with a warning', withParam('dir', undefined)],
    ['dependant directory', withParam('dir', 'dependant')],
    ['bad dir', withParam('dir', 'family')],
    ['name with bidi override', withParam('name', 'Fl\u202eock')],
    ['name of 64 code points', withParam('name', 'n'.repeat(64))],
    ['name of 65 code points', withParam('name', 'n'.repeat(65))],
    ['name of 64 astral code points', withParam('name', '\u{1F602}'.repeat(64))],
    ['name of 65 astral code points', withParam('name', '\u{1F602}'.repeat(65))],
    ['name only controls', withParam('name', '\u0000\u200b ')],
    ['name missing', withParam('name', undefined)],
    ['plus decodes to space', raw(q.replace('name=Flock', 'name=My+App'))],
    ['stray percent is literal', raw(q.replace('name=Flock', 'name=100%25+%ZZ'))],
    ['invalid UTF-8 decodes to U+FFFD', raw(q.replace('name=Flock', 'name=A%FFB'))],
    ['leading BOM in a value is kept', raw(q.replace('name=Flock', 'name=%EF%BB%BFFlock'))],
    ['empty segments are skipped', raw(`&&${q}&&`)],
    ['too long', `${base}&pad=${'x'.repeat(2048 - base.length)}`],
    ['exactly the cap', `${base}&pad=${'x'.repeat(2048 - base.length - 5)}`],
  ];
  emit('vectors/cases/pairing-uri.json', {
    description: 'parsePairingRequestV2(input, { nowSec }): the request (or null) and the warnings, in order.',
    nowSec: NOW,
    cases: cases.map(([name, input]) => ({ name, input, expected: ref.parsePairingRequestV2(input, { nowSec: NOW }) })),
  });
}

// ---------------------------------------------------------------------------
// ack.json
// ---------------------------------------------------------------------------
{
  const good = {
    v: 2, grantId: GRANT, railPubkey: 'b'.repeat(64), projectionTag: ref.projectionTag(GRANT),
    proposalTag: ref.proposalTag(GRANT, APP), relay: 'wss://relay.example.com',
    grantedCapabilities: ['signet.contacts.read:directory', 'signet.contacts.blocks.read'],
    maxStalenessSeconds: 21600, challenge: CHALLENGE,
  };
  const j = (o) => JSON.stringify(o);
  const cases = [
    ['baseline', j(good)],
    ['v as 2.0', j(good).replace('"v":2', '"v":2.0')],
    ['v as string', j({ ...good, v: '2' })],
    ['v1 ack', j({ ...good, v: 1 })],
    ['challenge case differs', j({ ...good, challenge: 'd'.repeat(32) })],
    ['duplicate challenge key, last wins', j(good).replace('"challenge"', '"challenge":"x","challenge"')],
    ['grantId uppercase', j({ ...good, grantId: 'F'.repeat(32) })],
    ['plaintext relay', j({ ...good, relay: 'ws://relay.example.com' })],
    ['unknown capability dropped', j({ ...good, grantedCapabilities: ['signet.contacts.blocks.read', 'x', 7, 'signet.contacts.read:directory'] })],
    ['only unknown capabilities', j({ ...good, grantedCapabilities: ['x'] })],
    ['capabilities not an array', j({ ...good, grantedCapabilities: 'signet.contacts.read:directory' })],
    ['staleness below the band', j({ ...good, maxStalenessSeconds: 10 })],
    ['staleness above the band', j({ ...good, maxStalenessSeconds: 1e9 })],
    ['staleness fractional', j({ ...good, maxStalenessSeconds: 7200.9 })],
    ['staleness a string', j({ ...good, maxStalenessSeconds: '7200' })],
    ['staleness negative', j({ ...good, maxStalenessSeconds: -5 })],
    ['staleness missing', j({ ...good, maxStalenessSeconds: undefined })],
    ['extra fields ignored', j({ ...good, extra: { nested: [1, 2] } })],
    ['not JSON', 'not json'],
    ['a JSON array', '[]'],
    ['JSON null', 'null'],
    ['surrounding whitespace', ` \n${j(good)}\t`],
  ];
  emit('vectors/cases/ack.json', {
    description: 'parsePairingAckV2(plaintext, expectedChallenge): the parsed ack or null.',
    expectedChallenge: CHALLENGE,
    cases: cases.map(([name, plaintext]) => ({ name, plaintext, expected: ref.parsePairingAckV2(plaintext, CHALLENGE) })),
  });
}

// ---------------------------------------------------------------------------
// projection-parse.json and projection-build.json
// ---------------------------------------------------------------------------
{
  const SCOPES = [
    'signet.contacts.read:directory', 'signet.contacts.read:method:phone', 'signet.contacts.read:method:email',
    'signet.contacts.read:method:website', 'signet.contacts.read:tier', 'signet.contacts.read:checks',
    'signet.contacts.read:check-records', 'signet.contacts.read:roles', 'signet.contacts.blocks.read',
  ];
  const body = (contacts, extra = {}) => ({
    v: 2, grantId: GRANT, scopes: SCOPES,
    frontier: { maxClock: 7, opCount: 9, publishedAt: NOW, deviceId: DEVICE },
    issuedAt: NOW, expiresAt: NOW + 3600, contacts, ...extra,
  });
  const cid = (n) => ref.scopedContactId(GRANT, `c${n}`);
  const pk = (c) => c.repeat(64);
  const j = (o) => JSON.stringify(o);
  const cases = [
    ['a minimal contact', j(body([{ contactId: cid(1) }]))],
    ['display name sanitised and capped', j(body([{ contactId: cid(1), displayName: `  \u202e${'x'.repeat(120)}` }]))],
    ['display name astral at the cap', j(body([{ contactId: cid(1), displayName: `${'y'.repeat(99)}\u{1F602}z` }]))],
    ['display name only invisible is dropped', j(body([{ contactId: cid(1), displayName: '\u200b\u2066 ' }]))],
    ['display name null is present but dropped', j(body([{ contactId: cid(1), displayName: null }]))],
    ['display name with quotes, backslash and U+2028', j(body([{ contactId: cid(1), displayName: 'A "B" \\ C\u2028D \u00e9' }]))],
    ['duplicate contactId keeps the first', j(body([{ contactId: cid(1), displayName: 'first' }, { contactId: cid(1), displayName: 'second' }]))],
    ['uppercase contactId drops the contact', j(body([{ contactId: cid(1).toUpperCase() }, { contactId: cid(2) }]))],
    ['non-object contacts are dropped', j(body([null, 'x', 3, [], { contactId: cid(2) }]))],
    ['bad tier drops the contact', j(body([{ contactId: cid(1), effectiveTier: 'family' }, { contactId: cid(2), effectiveTier: 'kin', tierSource: 'guardian-vouched' }]))],
    ['blocked as a string drops the contact', j(body([{ contactId: cid(1), blocked: 'true' }]))],
    ['identities capped at 16, bad ones dropped', j(body([{ contactId: cid(1), identities: [
      { pubkey: pk('A') }, { pubkey: pk('c'), verification: 'weird' }, { pubkey: pk('d'), verification: 'mutual' },
      ...Array.from({ length: 16 }, (_, i) => ({ pubkey: (i % 16).toString(16).repeat(64) })),
    ] }]))],
    ['roles capped at 8 and sanitised', j(body([{ contactId: cid(1), roles: ['a', 7, ' b ', '', 'c'.repeat(50), 'd', 'e', 'f', 'g', 'h'] }]))],
    ['methods: bad verification and empty value dropped', j(body([{ contactId: cid(1), contactMethods: [
      { kind: 'email', value: 'a@b', verification: 'mutual' }, { kind: 'phone', value: '  ' },
      { kind: 'website', value: 'https://x', verification: 'proven' }, { kind: 'phone', value: `${'1'.repeat(400)}` },
    ] }]))],
    ['method with no kind is uncovered: projection refused', j(body([{ contactId: cid(1), contactMethods: [{ value: 'x' }] }]))],
    ['method kind other without its capability: refused', j(body([{ contactId: cid(1), contactMethods: [{ kind: 'other', value: 'x' }] }]))],
    ['checks: invalid entries skipped', j(body([{ contactId: cid(1), checks: [
      { pubkey: pk('c'), method: 'words', checkedAt: 1 }, { pubkey: pk('c'), method: 'telepathy', checkedAt: 1 },
      { pubkey: pk('c'), method: 'nip05', checkedAt: 1.5 }, { pubkey: pk('c'), method: 'nip05', checkedAt: -1 },
      null, { pubkey: pk('C'), method: 'in-person', checkedAt: 2 }, { pubkey: pk('e'), method: 'app-attested', checkedAt: 9007199254740991 },
    ] }]))],
    ['avatar is never covered: refused', j(body([{ contactId: cid(1), avatar: { url: 'https://x/y.png', hash: pk('a') } }]))],
    ['linkedPubkeys is never covered: refused', j(body([{ contactId: cid(1), linkedPubkeys: [pk('a')] }]))],
    ['blocks-only scope sees a blocked contact', j({ ...body([{ contactId: cid(1), blocked: true, identities: [{ pubkey: pk('d') }] }]), scopes: ['signet.contacts.blocks.read'] })],
    ['blocks-only scope refuses an unblocked contact', j({ ...body([{ contactId: cid(1), blocked: false, identities: [{ pubkey: pk('d') }] }]), scopes: ['signet.contacts.blocks.read'] })],
    ['blocks-only scope refuses a null displayName', j({ ...body([{ contactId: cid(1), blocked: true, displayName: null }]), scopes: ['signet.contacts.blocks.read'] })],
    ['scopes: unknown, duplicate and out of order', j({ ...body([{ contactId: cid(1) }]), scopes: ['x', 'signet.contacts.blocks.read', 'signet.contacts.read:directory', 'signet.contacts.read:directory'] })],
    ['scopes: a known scope past the 16-entry cap is lost', j({ ...body([{ contactId: cid(1) }]), scopes: [...Array(16).fill('x'), 'signet.contacts.read:directory'] })],
    ['expiresAt before issuedAt', j(body([], { expiresAt: NOW - 1 }))],
    ['issuedAt as 1700000000.0', j(body([])).replace(`"issuedAt":${NOW}`, `"issuedAt":${NOW}.0`)],
    ['issuedAt fractional', j(body([], { issuedAt: NOW + 0.5 }))],
    ['frontier as an array', j(body([], { frontier: [] }))],
    ['frontier deviceId uppercase', j(body([], { frontier: { maxClock: 7, opCount: 9, publishedAt: NOW, deviceId: 'A'.repeat(32) } }))],
    ['frontier missing publishedAt', j(body([], { frontier: { maxClock: 7, opCount: 9, deviceId: DEVICE } }))],
    ['revoked must be exactly true', j(body([], { revoked: 'true', truncated: 1 }))],
    ['revoked and truncated', j(body([], { revoked: true, truncated: true }))],
    ['v as string', j(body([], { v: '2' }))],
    ['over the contact cap is truncated', j(body(Array.from({ length: 2001 }, (_, i) => ({ contactId: ref.scopedContactId(GRANT, `n${i}`) }))))],
  ];
  emit('vectors/cases/projection-parse.json', {
    description: 'parseProjection(plaintext): the parsed projection or null.',
    cases: cases.map(([name, plaintext]) => ({ name, plaintext, expected: ref.parseProjection(plaintext) })),
  });

  // Canonical builder output: parse, build, and compare bytes. Exercises key
  // order and JSON.stringify's exact string escaping.
  const buildable = cases
    .map(([name, plaintext]) => [name, ref.parseProjection(plaintext)])
    .filter(([, p]) => p !== null && p.contacts.length < 100);
  emit('vectors/cases/projection-build.json', {
    description: 'buildProjection(parseProjection(input)) must equal `built` byte for byte.',
    cases: buildable.map(([name, p]) => ({ name, input: p, built: outcome(() => ref.buildProjection(p)) })),
  });
}

// ---------------------------------------------------------------------------
// proposal-parse.json
// ---------------------------------------------------------------------------
{
  const op = (n) => n.toString(16).padStart(32, '0');
  const add = (n, extra = {}) => ({ v: 1, grantId: GRANT, operationId: op(n), action: 'add-ken', value: { pubkey: 'c'.repeat(64), displayName: 'Ada' }, createdAt: NOW, ...extra });
  const ren = (n, value) => ({ v: 1, grantId: GRANT, operationId: op(n), action: 'rename-app-label', value, createdAt: NOW });
  const j = (o) => JSON.stringify(o);
  const cases = [
    ['baseline', j({ v: 1, proposals: [add(1), ren(2, { contactId: 'd'.repeat(32), label: 'Coach', updatedAt: 5 })] })],
    ['invalid entries dropped', j({ v: 1, proposals: [
      add(1, { v: 2 }), add(2, { action: 'remove' }), add(3, { createdAt: -1 }), add(4, { value: { pubkey: 'c'.repeat(64), displayName: '\u200b' } }),
      ren(5, { contactId: 'd'.repeat(32), label: 'L' }), ren(6, { contactId: 'd'.repeat(32), label: 'L', updatedAt: 1.5 }),
      ren(7, { contactId: 'd'.repeat(32), label: `  ${'l'.repeat(120)}`, updatedAt: 0 }), add(8, { value: [] }), null, 'x',
    ] })],
    ['capped at 50', j({ v: 1, proposals: Array.from({ length: 51 }, (_, i) => add(i + 1)) })],
    ['v2 batch', j({ v: 2, proposals: [add(1)] })],
    ['proposals not an array', j({ v: 1, proposals: {} })],
    ['empty batch parses', j({ v: 1, proposals: [] })],
  ];
  emit('vectors/cases/proposal-parse.json', {
    description: 'parseProposalBatch(plaintext): the parsed batch or null.',
    cases: cases.map(([name, plaintext]) => ({ name, plaintext, expected: ref.parseProposalBatch(plaintext) })),
  });
}

// ---------------------------------------------------------------------------
// invite.json: parseContactInvite, with the WHATWG relay normalisation that
// ends up inside every contact-exchange hash.
// ---------------------------------------------------------------------------
{
  const inv = (relays, extra = {}) => JSON.stringify({ v: 1, recipient: 'a'.repeat(64), secret: 'b'.repeat(64), relays, ...extra });
  const relayInputs = [
    'wss://relay.example.com', 'WSS://Relay.EXAMPLE.com', 'wss://relay.example.com:443', 'wss://relay.example.com:0443/',
    'wss://relay.example.com:4430', 'wss://relay.example.com:65536', 'wss://relay.example.com:', 'wss:relay.example.com',
    'wss:\\\\relay.example.com\\path', 'wss:///relay.example.com', 'wss://relay.example.com/a/./b/../c', 'wss://relay.example.com/%2e%2E/x/.',
    'wss://relay.example.com/a b"c<d>e`f{g}h|i^j', 'wss://relay.example.com/?q=a b\'c"d', 'wss://relay.example.com/#', 'wss://relay.example.com/#frag',
    'wss://user@relay.example.com', 'wss://:pass@relay.example.com', 'wss://@relay.example.com', 'wss://relay.example.com@',
    'wss://0x7f.1/', 'wss://127.1', 'wss://0177.0.0.1', 'wss://1.2.3.4.5', 'wss://256.0.0.1', 'wss://4294967295', 'wss://4294967296',
    'wss://1.2.3.4.', 'wss://09.1.1.1', 'wss://[::1]/', 'wss://[::FFFF:1.2.3.4]:8443', 'wss://[1:0:0:2:0:0:0:3]', 'wss://[::1', 'wss://[:1]',
    'wss://ex%41mple.com', 'wss://a%00b', 'wss://a b', 'wss://a<b', 'wss://xn--nxasmq6b.com', 'wss://\u00e9xample.com/\u00e9',
    '  wss://relay.example.com/\t\n', 'wss://relay.example.com/\u{1F602}', 'https://relay.example.com', 'ws://relay.example.com', 'wss://',
    'relay.example.com', `wss://${'a'.repeat(506)}`, `wss://${'a'.repeat(507)}`, 'wss://a..b./c',
  ];
  const cases = [
    ...relayInputs.map((r) => [`relay ${JSON.stringify(r)}`, inv([r])]),
    ['duplicate relays after normalisation collapse', inv(['wss://A.example', 'wss://a.example/', 'wss://b.example'])],
    ['no relays', inv([])],
    ['nine relays', inv(Array.from({ length: 9 }, (_, i) => `wss://r${i}.example`))],
    ['relay not a string', inv([7])],
    ['expiresAt in the future', inv(['wss://r.example'], { expiresAt: NOW + 1 })],
    ['expiresAt now is expired', inv(['wss://r.example'], { expiresAt: NOW })],
    ['expiresAt fractional', inv(['wss://r.example'], { expiresAt: NOW + 0.5 })],
    ['caption', inv(['wss://r.example'], { caption: 'Hi \u00e9 \u{1F602}' })],
    ['caption with a newline', inv(['wss://r.example'], { caption: 'a\nb' })],
    ['caption with a bidi override', inv(['wss://r.example'], { caption: 'a\u202eb' })],
    ['caption with a zero-width space is allowed', inv(['wss://r.example'], { caption: 'a\u200bb' })],
    ['caption of 200 units', inv(['wss://r.example'], { caption: 'c'.repeat(200) })],
    ['caption of 201 units', inv(['wss://r.example'], { caption: 'c'.repeat(201) })],
    ['uppercase recipient', JSON.stringify({ v: 1, recipient: 'A'.repeat(64), secret: 'b'.repeat(64), relays: ['wss://r.example'] })],
    ['v2 invite', JSON.stringify({ v: 2, recipient: 'a'.repeat(64), secret: 'b'.repeat(64), relays: ['wss://r.example'] })],
    ['over 8192 bytes', inv(['wss://r.example'], { pad: '\u00e9'.repeat(4100) })],
  ];
  emit('vectors/cases/invite.json', {
    description: 'parseContactInvite(raw, now): the invite (relays normalised as WHATWG URL href, deduplicated) or null. Relay normalisation is hashed into every exchange transcript, so it must match exactly. Generated on the Node version named in manifest.json.',
    now: NOW,
    cases: cases.map(([name, raw]) => ({ name, raw, expected: ref.parseContactInvite(raw, NOW) })),
  });
}

// ---------------------------------------------------------------------------
// contact-exchange.json: messages whose reply relays need normalising, with
// the parsed canonical message and its transcript hash.
// ---------------------------------------------------------------------------
{
  const A = '1'.repeat(64);
  const B = '2'.repeat(64);
  const nonce = '3'.repeat(64);
  const id = '4'.repeat(32);
  const commitment = ref.contactCommitment({ id, from: A, to: B, nonce });
  const req = (reply, extra = {}) => JSON.stringify({ v: 1, type: 'signet-contact-request', id, from: A, to: B, createdAt: NOW, expiresAt: NOW + 60, commitment, reply, ...extra });
  const cases = [
    ['plain request', req({ secret: 'b'.repeat(64), relays: ['wss://relay.example.com'] })],
    ['relays normalised before hashing', req({ secret: 'b'.repeat(64), relays: ['WSS://Relay.Example.COM:443', 'wss://relay.example.com/', 'wss://[::FFFF:1.2.3.4]/a/../b c'] })],
    ['keys in another order hash the same', JSON.stringify({ reply: { relays: ['wss://relay.example.com'], secret: 'b'.repeat(64) }, commitment, expiresAt: NOW + 60, createdAt: NOW, to: B, from: A, id, type: 'signet-contact-request', v: 1 })],
    ['from equals to', req({ secret: 'b'.repeat(64), relays: ['wss://r.example'] }, { to: A })],
    ['ttl over 30 days', req({ secret: 'b'.repeat(64), relays: ['wss://r.example'] }, { expiresAt: NOW + 30 * 86400 + 1 })],
    ['acceptance', JSON.stringify({ v: 1, type: 'signet-contact-accept', id, from: B, to: A, createdAt: NOW, requestHash: 'e'.repeat(64), nonce })],
    ['reveal missing acceptanceHash', JSON.stringify({ v: 1, type: 'signet-contact-reveal', id, from: A, to: B, createdAt: NOW, requestHash: 'e'.repeat(64), nonce })],
  ];
  emit('vectors/cases/contact-exchange.json', {
    description: 'parseContactExchangeMessage(raw) and, where it parses, contactMessageHash of the result.',
    cases: cases.map(([name, raw]) => {
      const parsed = ref.parseContactExchangeMessage(raw);
      return { name, raw, expected: parsed, hash: parsed ? ref.contactMessageHash(parsed) : null };
    }),
  });
}

// ---------------------------------------------------------------------------
// stringify.json: JSON.stringify(JSON.parse(input)), the serialisation every
// digest on this wire is taken over.
// ---------------------------------------------------------------------------
{
  const inputs = [
    '"plain"', '"quote \\" backslash \\\\ slash \\/"', '"\\u0000\\u0001\\u001f\\u007f\\u0080"', '"\\b\\f\\n\\r\\t"',
    '"\\u2028\\u2029\\ufeff"', '"\\ud83d\\ude02"', '"\\ud800 lone high"', '"lone low \\udc00"', '"\\udc00\\ud800"', '"\\u00e9 raw \u00e9"',
    '0', '-0', '1', '-1', '1.0', '1.5', '0.1', '1e21', '1e20', '123456789012345678901', '1.7e9', '1e-7', '0.000001', '1.5e-7',
    '9007199254740993', '5e-324', '1.7976931348623157e308', '0.1234567890123456789', '100', '12345.678e3',
    '{"b":1,"a":2}', '{"a":1,"a":2,"b":3}', '[1,[2,[3]],{}]', 'true', 'null', ' { "sp" : [ 1 , 2 ] } ',
  ];
  emit('vectors/cases/stringify.json', {
    description: 'JSON.stringify(JSON.parse(input)): number formatting, string escaping, duplicate keys (first position, last value) and whitespace.',
    cases: inputs.map((input) => ({ input, output: JSON.stringify(JSON.parse(input)) })),
  });
}

// ---------------------------------------------------------------------------
// envelope-parse.json
// ---------------------------------------------------------------------------
{
  const good = { v: 2, k: 'k', iv: 'aXY=', ct: 'Y3Q=', b: 4096 };
  const j = (o) => JSON.stringify(o);
  const cases = [
    ['baseline', j(good)], ['b as 4096.0', j(good).replace('4096', '4096.0')], ['b not a bucket', j({ ...good, b: 4097 })],
    ['v1', j({ ...good, v: 1 })], ['k not a string', j({ ...good, k: 1 })], ['array', '[]'], ['not json', '{'],
    ['over the size cap', j({ ...good, k: 'k'.repeat(100_000) })],
  ];
  emit('vectors/cases/envelope-parse.json', {
    description: 'parseVaultEnvelope(content): the envelope or null. The size cap applies before parsing.',
    cases: cases.map(([name, content]) => ({ name, content, expected: ref.parseVaultEnvelope(content) })),
  });
}

// ---------------------------------------------------------------------------
// state.json: applyProjection sequences.
// ---------------------------------------------------------------------------
{
  const proj = (publishedAt, maxClock, contacts, extra = {}) => ref.parseProjection(JSON.stringify({
    v: 2, grantId: GRANT, scopes: ['signet.contacts.read:directory', 'signet.contacts.blocks.read'],
    frontier: { maxClock, opCount: 1, publishedAt, deviceId: DEVICE }, issuedAt: publishedAt, expiresAt: publishedAt + 3600,
    contacts, ...extra,
  }));
  const blocked = (n, key) => ({ contactId: ref.scopedContactId(GRANT, `b${n}`), blocked: true, identities: [{ pubkey: key.repeat(64) }] });
  const friend = (n, key) => ({ contactId: ref.scopedContactId(GRANT, `f${n}`), blocked: false, identities: [{ pubkey: key.repeat(64) }] });
  const steps = [
    ['first projection', proj(NOW, 5, [friend(1, 'a'), blocked(1, 'b')]), NOW],
    ['older replay ignored', proj(NOW - 10, 9, [friend(1, 'a')]), NOW + 1],
    ['exact tie ignored', proj(NOW, 5, []), NOW + 2],
    ['same second, higher clock wins', proj(NOW, 6, [friend(1, 'a'), blocked(2, 'c')]), NOW + 3],
    ['newer second, lower clock still wins (R-30)', proj(NOW + 5, 1, [blocked(2, 'c'), blocked(3, 'd')]), NOW + 4],
    ['out-of-order revocation applies, floor kept, blocks sticky', proj(NOW - 100, 1, [], { revoked: true }), NOW + 5],
    ['stale snapshot cannot un-revoke', proj(NOW + 5, 1, [friend(1, 'a')]), NOW + 6],
    ['newer snapshot un-revokes', proj(NOW + 6, 1, [friend(1, 'a')]), NOW + 7],
    ['another grant is ignored', { ...proj(NOW + 9, 1, []), grantId: 'e'.repeat(32) }, NOW + 8],
  ];
  let state = ref.emptyContactsState();
  const out = [];
  for (const [name, projection, nowSec] of steps) {
    const next = ref.applyProjection(state, projection, nowSec);
    out.push({ name, projection, nowSec, accepted: next !== state, state: next, fresh: ref.isFresh(next, nowSec), visible: ref.visibleContacts(next).map((c) => c.contactId) });
    state = next;
  }
  emit('vectors/cases/state.json', {
    description: 'applyProjection over a sequence, starting from emptyContactsState(). `accepted` is false when the state is returned unchanged.',
    steps: out,
  });
}

// ---------------------------------------------------------------------------
// app-invite.json
// ---------------------------------------------------------------------------
{
  const reqId = '5'.repeat(32);
  const base = { v: 1, grantId: GRANT, requestId: reqId, createdAt: NOW };
  const invite = { v: 1, recipient: 'a'.repeat(64), secret: 'b'.repeat(64), relays: ['WSS://R.example'] };
  const j = (o) => JSON.stringify(o);
  const requests = [
    ['create single-use', j({ ...base, action: 'create-invite', mode: 'single-use' }), NOW + 10],
    ['create standing', j({ ...base, action: 'create-invite', mode: 'standing' }), NOW],
    ['create without mode', j({ ...base, action: 'create-invite' }), NOW],
    ['create with an invite', j({ ...base, action: 'create-invite', mode: 'standing', invite }), NOW],
    ['receive', j({ ...base, action: 'receive-invite', invite }), NOW],
    ['receive with a mode', j({ ...base, action: 'receive-invite', mode: 'standing', invite }), NOW],
    ['receive without an invite', j({ ...base, action: 'receive-invite' }), NOW],
    ['from the future', j({ ...base, action: 'create-invite', mode: 'standing' }), NOW - 1],
    ['expired', j({ ...base, action: 'create-invite', mode: 'standing' }), NOW + 300],
  ];
  const create = ref.parseAppInviteRequest(j({ ...base, action: 'create-invite', mode: 'standing' }), NOW);
  const receive = ref.parseAppInviteRequest(j({ ...base, action: 'receive-invite', invite }), NOW);
  const replies = [
    ['issued', create, j({ ...base, status: 'issued', invite }), NOW + 5],
    ['issued without an invite', create, j({ ...base, status: 'issued' }), NOW + 5],
    ['queued for a create', create, j({ ...base, status: 'queued' }), NOW + 5],
    ['queued', receive, j({ ...base, status: 'queued' }), NOW + 5],
    ['queued with an invite', receive, j({ ...base, status: 'queued', invite }), NOW + 5],
    ['other request id', receive, j({ ...base, requestId: '6'.repeat(32), status: 'queued' }), NOW + 5],
    ['reply older than the request', receive, j({ ...base, createdAt: NOW - 1, status: 'queued' }), NOW + 5],
    ['window closed', receive, j({ ...base, status: 'queued' }), NOW + 300],
  ];
  emit('vectors/cases/app-invite.json', {
    description: 'parseAppInviteRequest(json, now) and parseAppInviteReply(json, request, now).',
    requests: requests.map(([name, json, now]) => ({ name, json, now, expected: ref.parseAppInviteRequest(json, now) })),
    replies: replies.map(([name, request, json, now]) => ({ name, request, json, now, expected: ref.parseAppInviteReply(json, request, now) })),
  });
}

// ---------------------------------------------------------------------------
// nostr.json: the Nostr primitives the adapters depend on, from nostr-tools
// as the reference resolves it: NIP-01 event ids (and a signature to verify),
// NIP-44 v2 conversation keys, and payloads at every padding boundary.
// ---------------------------------------------------------------------------
{
  // The ESM entry points, resolved through the reference's own install.
  const req = createRequire(join(refDir, 'package.json'));
  const ntDir = req.resolve.paths('nostr-tools').map((d) => join(d, 'nostr-tools')).find((d) => existsSync(join(d, 'package.json')));
  const ntPkg = JSON.parse(readFileSync(join(ntDir, 'package.json'), 'utf8'));
  const esm = (sub) => import(pathToFileURL(join(ntDir, ntPkg.exports[sub].import)).href);
  const pure = await esm('./pure');
  const nip44 = await esm('./nip44');
  const hexToBytes = (h) => Uint8Array.from(h.match(/../g).map((b) => parseInt(b, 16)));
  const sk1 = '0000000000000000000000000000000000000000000000000000000000000001';
  const sk2 = 'ca40240ab6c15508af98172ea2d3a31d510889672cc9e87a73d489374fcd66a6';
  const templates = [
    { kind: 1, created_at: NOW, tags: [], content: 'hello' },
    { kind: 30078, created_at: NOW, tags: [['d', 'x'], ['p', 'a'.repeat(64)], ['expiration', String(NOW + 300)]], content: '{"v":2}' },
    { kind: 13, created_at: 0, tags: [], content: 'quote " backslash \\ newline \n tab \t nul \u0000 del \u007f e\u0301 \u2028 \ud83d\ude02' },
  ];
  // finalizeEvent signs with random aux data; BIP-340 with zero aux keeps
  // this file reproducible, and verifyEvent proves the result is still valid.
  const { schnorr } = await import(pathToFileURL(join(refDir, 'node_modules', '@noble', 'curves', 'secp256k1.js')).href);
  const events = templates.map((t) => {
    const unsigned = { ...t, pubkey: pure.getPublicKey(hexToBytes(sk2)) };
    const id = pure.getEventHash(unsigned);
    const sig = Buffer.from(schnorr.sign(hexToBytes(id), hexToBytes(sk2), new Uint8Array(32))).toString('hex');
    const event = { ...unsigned, id, sig };
    if (!pure.verifyEvent({ ...event })) throw new Error('reference could not verify its own event');
    return event;
  });
  const conversationKey = nip44.v2.utils.getConversationKey(hexToBytes(sk1), pure.getPublicKey(hexToBytes(sk2)));
  const nonce = hexToBytes('11'.repeat(32));
  const lengths = [1, 2, 31, 32, 33, 63, 64, 65, 255, 256, 257, 511, 512, 1000, 65535];
  emit('vectors/cases/nostr.json', {
    description: 'NIP-01 event ids and signatures, and NIP-44 v2 from nostr-tools. TEST KEYS ONLY.',
    nostrTools: ntPkg.version,
    secretKeys: { sk1, sk2 },
    publicKeys: { pk1: pure.getPublicKey(hexToBytes(sk1)), pk2: pure.getPublicKey(hexToBytes(sk2)) },
    events,
    nip44: {
      conversationKey: Buffer.from(conversationKey).toString('hex'),
      nonce: '11'.repeat(32),
      payloads: lengths.map((n) => {
        const plaintext = n > 1 ? `${'x'.repeat(n - 1)}y` : 'y';
        return { length: n, plaintext, payload: nip44.v2.encrypt(plaintext, conversationKey, nonce) };
      }),
      unicode: { plaintext: '\u00e9\ud83d\ude02 \u2028', payload: nip44.v2.encrypt('\u00e9\ud83d\ude02 \u2028', conversationKey, nonce) },
    },
  });
}

// ---------------------------------------------------------------------------
// upstream-malformed.json: the upstream frozen files list "malformed" inputs
// without saying what a parser returns for them, and some of them parse (an
// unknown field is dropped; a bad proposal inside a batch is dropped). This
// records what the reference actually returns, so a port can check it.
// ---------------------------------------------------------------------------
{
  const upstream = (name) => JSON.parse(readFileSync(join(refDir, 'vectors', name), 'utf8'));
  emit('vectors/cases/upstream-malformed.json', {
    description: 'What the reference parser returns for each entry of the upstream vectors\' `malformed` (and `uncovered`) arrays.',
    projection: [
      ...upstream('projection.v2.json').malformed.map((plaintext) => ({ plaintext, expected: ref.parseProjection(plaintext) })),
      ...upstream('projection.v2.json').uncovered.map(({ plaintext }) => ({ plaintext, expected: ref.parseProjection(plaintext) })),
    ],
    proposal: upstream('proposal.v1.json').malformed.map((plaintext) => ({ plaintext, expected: ref.parseProposalBatch(plaintext) })),
  });
}

// ---------------------------------------------------------------------------
// manifest.json, and the upstream sync
// ---------------------------------------------------------------------------
{
  const upstream = join(refDir, 'vectors');
  for (const name of readdirSync(upstream).filter((n) => n.endsWith('.json'))) {
    const src = readFileSync(join(upstream, name), 'utf8');
    const dst = join(root, 'vectors', name);
    if (CHECK) {
      if (!existsSync(dst) || readFileSync(dst, 'utf8') !== src) failures.push(`vectors/${name}`);
    } else {
      copyFileSync(join(upstream, name), dst);
    }
  }
  const sha = (p) => createHash('sha256').update(readFileSync(join(root, p))).digest('hex');
  const list = (dir) => readdirSync(join(root, dir)).filter((n) => n.endsWith('.json') && n !== 'manifest.json').sort().map((n) => `${dir}/${n}`);
  let commit = 'unknown';
  try { commit = execFileSync('git', ['-C', refDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }
  const pkg = JSON.parse(readFileSync(join(refDir, 'package.json'), 'utf8'));
  if (!CHECK) {
    emit('vectors/manifest.json', {
      description: 'Provenance for every vector file. vectors/*.json are copied verbatim from the reference; vectors/cases/*.json are generated from it by scripts/generate.mjs.',
      reference: { package: pkg.name, version: pkg.version, commit },
      generator: { node: process.version },
      files: Object.fromEntries([...list('vectors'), ...list('vectors/cases')].map((p) => [p, sha(p)])),
    });
  }
}

if (failures.length > 0) {
  console.error(`out of date: ${failures.join(', ')}`);
  process.exit(1);
}
