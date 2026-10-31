#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// nostr-mint.mjs — mint (or complete) an entity's Nostr identity
//
// Part of `koad-io gestate`. The Nostr keypair is Path B (VESTA-SPEC-221): an
// INDEPENDENT secp256k1 key, never derived from the entity's GPG or SSH keys —
// it is bound to them later by cross-signature, not by derivation. This file
// therefore mints fresh entropy and touches nothing else.
//
// Zero dependencies. node's own crypto (OpenSSL secp256k1) plus a local bech32
// encoder. The bootstrap must never depend on the rail: `ecoincore:nostr` can
// import nostr-tools, we cannot — entity gestation has to work on a machine
// that has never seen an npm install.
//
// Posture (from the August 2026 leak, and the brief that produced this file):
//
//   * a key is written ONCE. Existing crown.nsec → `present`, never rewritten.
//     Rotation is a deliberate separate act; a repair command that can silently
//     replace a key is a foot-gun.
//   * the secret is never printed, never logged, never echoed in an error.
//     Only the npub — the public, provable half — crosses the boundary.
//   * files are created with 'wx' (fails if present) so no code path here can
//     clobber key material, and crown.nsec lands mode 600 at creation.
//
// Layout written under <entity-dir>/id/nostr/:
//
//   crown.nsec   32-byte secret as 64-char lowercase hex — mode 600, gitignored
//   npub         NIP-19 bech32 public identity — tracked, provable
//   pubkey.hex   64-char x-only public key    — tracked, provable
//
// Usage:
//   node nostr-mint.mjs --entity-dir <path to ~/.<name>>
//
// Prints one JSON object on stdout:
//   { status: "minted"|"published"|"present", npub, created: [...],
//     existing: [...], mismatch: bool }
//
//   minted     — a new keypair was generated
//   published  — crown.nsec already existed; the missing public artifacts were
//                derived from it (never from a new key)
//   present    — everything was already in place; nothing written
//
// Exit codes: 0 ok · 2 usage/IO error · 3 existing key material is unreadable
// or the on-disk npub contradicts the key (reported, never silently repaired).
//
// Ref: VESTA-SPEC-221 §4 — key lifecycle, Path B independent keypair
// Ref: ~/.ecoincore/packages/nostr/server/keys.js — the rail's read side

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// bech32 (BIP-173) — encode/decode, local, no deps
// ---------------------------------------------------------------------------

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values) {
	let chk = 1;
	for (const v of values) {
		const top = chk >>> 25;
		chk = ((chk & 0x1ffffff) << 5) ^ v;
		for (let i = 0; i < 5; i++) {
			if ((top >>> i) & 1) chk ^= GENERATOR[i];
		}
	}
	return chk >>> 0;
}

function hrpExpand(hrp) {
	const out = [];
	for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >>> 5);
	out.push(0);
	for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
	return out;
}

// Regroup bits. 8→5 for encoding, 5→8 for decoding. Returns null on bad input.
function convertBits(data, from, to, pad) {
	let acc = 0;
	let bits = 0;
	const maxv = (1 << to) - 1;
	const out = [];
	for (const v of data) {
		if (v < 0 || v >>> from) return null;
		acc = (acc << from) | v;
		bits += from;
		while (bits >= to) {
			bits -= to;
			out.push((acc >>> bits) & maxv);
		}
	}
	if (pad) {
		if (bits) out.push((acc << (to - bits)) & maxv);
	} else if (bits >= from || ((acc << (to - bits)) & maxv)) {
		return null;
	}
	return out;
}

function bech32Encode(hrp, bytes) {
	const data = convertBits(Array.from(bytes), 8, 5, true);
	if (!data) return null;
	const mod = polymod(hrpExpand(hrp).concat(data, [0, 0, 0, 0, 0, 0])) ^ 1;
	const checksum = [];
	for (let i = 0; i < 6; i++) checksum.push((mod >>> (5 * (5 - i))) & 31);
	return hrp + '1' + data.concat(checksum).map((d) => CHARSET[d]).join('');
}

// Returns { hrp, bytes } or null. Checksum is verified — a corrupted nsec file
// must not be silently accepted as some other key.
function bech32Decode(str) {
	const s = String(str || '').trim().toLowerCase();
	const pos = s.lastIndexOf('1');
	if (pos < 1 || pos + 7 > s.length) return null;
	const hrp = s.slice(0, pos);
	const words = [];
	for (const ch of s.slice(pos + 1)) {
		const idx = CHARSET.indexOf(ch);
		if (idx === -1) return null;
		words.push(idx);
	}
	if (polymod(hrpExpand(hrp).concat(words)) !== 1) return null;
	const bytes = convertBits(words.slice(0, -6), 5, 8, false);
	if (!bytes) return null;
	return { hrp, bytes: Uint8Array.from(bytes) };
}

// ---------------------------------------------------------------------------
// secp256k1 — x-only public key
// ---------------------------------------------------------------------------

// Order of the secp256k1 group. A private key is valid iff 0 < k < n.
const CURVE_ORDER = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');

function isValidScalar(buf) {
	const k = BigInt('0x' + buf.toString('hex'));
	return k > 0n && k < CURVE_ORDER;
}

// x-only (BIP-340 / NIP-01) public key from a 32-byte secret.
// The ECDH public key is the 65-byte uncompressed point 04||X||Y; Nostr's
// x-only key is that X. Returns 32 bytes, or null on an unusable scalar.
function xOnlyPublicKey(privBuf) {
	const ecdh = crypto.createECDH('secp256k1');
	try {
		ecdh.setPrivateKey(privBuf);
	} catch (e) {
		return null;
	}
	const pub = ecdh.getPublicKey(); // 65 bytes, uncompressed
	if (pub.length !== 65 || pub[0] !== 0x04) return null;
	return Buffer.from(pub.subarray(1, 33));
}

// ---------------------------------------------------------------------------
// File helpers — create-only, no overwrite path
// ---------------------------------------------------------------------------

function writeOnce(file, content, mode) {
	// 'wx' is the whole safety property: if anything is already there, this
	// throws EEXIST instead of replacing key material.
	try {
		fs.writeFileSync(file, content, { flag: 'wx', mode: mode });
		return true;
	} catch (e) {
		if (e.code === 'EEXIST') return false;
		throw e;
	}
}

function readText(file) {
	try {
		const st = fs.statSync(file);
		if (!st.isFile()) return null;
		return fs.readFileSync(file, 'utf8');
	} catch (e) {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function argValue(flag) {
	const i = process.argv.indexOf(flag);
	return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

function fail(code, message) {
	// Never include key material here — message is built from fixed strings.
	process.stderr.write(`nostr-mint: ${message}\n`);
	process.exit(code);
}

const entityDir = argValue('--entity-dir');
if (!entityDir || !entityDir.startsWith('/')) {
	fail(2, 'usage: nostr-mint.mjs --entity-dir <absolute path to ~/.<name>>');
}

const nostrDir = path.join(entityDir, 'id', 'nostr');
const crownPath = path.join(nostrDir, 'crown.nsec');
const npubPath = path.join(nostrDir, 'npub');
const pubkeyPath = path.join(nostrDir, 'pubkey.hex');

try {
	fs.mkdirSync(nostrDir, { recursive: true, mode: 0o700 });
} catch (e) {
	fail(2, `cannot create the nostr directory: ${e.code || e.message}`);
}

const created = [];
const existing = [];

// ---------------------------------------------------------------------------
// Resolve the secret: read what is there, or mint only if nothing is
// ---------------------------------------------------------------------------

let privBuf = null;
let status = 'present';

const rawSecret = readText(crownPath);

if (rawSecret !== null) {
	// An existing key is sacred. Read it, publish its public half if the public
	// half is missing, and never write the secret again.
	const s = rawSecret.trim();
	let candidate = null;

	if (/^[0-9a-fA-F]{64}$/.test(s)) {
		candidate = Buffer.from(s.toLowerCase(), 'hex');
	} else if (/^nsec1[02-9ac-hj-np-z]+$/.test(s)) {
		// Some entities may hold an nsec rather than hex; accept it, but do not
		// rewrite it — the file is the operator's, not ours.
		const dec = bech32Decode(s);
		if (dec && dec.hrp === 'nsec' && dec.bytes.length === 32) {
			candidate = Buffer.from(dec.bytes);
		}
	}

	if (!candidate || !isValidScalar(candidate)) {
		if (candidate) candidate.fill(0);
		fail(3, 'crown.nsec exists but is not a usable secp256k1 secret — left untouched');
	}
	privBuf = candidate;
	existing.push('crown.nsec');
} else {
	// Mint: fresh entropy, validated scalar, then write once with mode 600.
	for (let attempt = 0; attempt < 16; attempt++) {
		const candidate = crypto.randomBytes(32);
		if (isValidScalar(candidate)) {
			privBuf = candidate;
			break;
		}
		candidate.fill(0);
	}
	if (!privBuf) fail(2, 'could not generate a valid secp256k1 scalar');

	if (writeOnce(crownPath, privBuf.toString('hex') + '\n', 0o600)) {
		// Belt and braces: 'wx' honors mode only on creation, and umask can
		// narrow it. Force 600 so the secret is never group/world readable.
		try {
			fs.chmodSync(crownPath, 0o600);
		} catch (e) {
			/* mode already 600 from 'wx'; a chmod failure is not fatal */
		}
		created.push('crown.nsec');
		status = 'minted';
	} else {
		// Lost a race with another process — re-read rather than overwrite.
		const again = readText(crownPath);
		const s = again === null ? '' : again.trim();
		if (!/^[0-9a-fA-F]{64}$/.test(s)) fail(3, 'crown.nsec appeared mid-mint and is unreadable — left untouched');
		privBuf.fill(0);
		privBuf = Buffer.from(s.toLowerCase(), 'hex');
		existing.push('crown.nsec');
	}
}

// ---------------------------------------------------------------------------
// Derive the public half and publish whatever is missing
// ---------------------------------------------------------------------------

const pubBuf = xOnlyPublicKey(privBuf);
privBuf.fill(0); // drop the secret before anything is written out

if (!pubBuf) fail(3, 'the stored secret did not yield a valid secp256k1 public key');

const pubkeyHex = pubBuf.toString('hex');
const npub = bech32Encode('npub', pubBuf);
if (!npub) fail(2, 'bech32 encoding of npub failed');

let mismatch = false;

// pubkey.hex — tracked, one line, x-only
const onDiskPubHex = readText(pubkeyPath);
if (onDiskPubHex === null) {
	if (writeOnce(pubkeyPath, pubkeyHex + '\n', 0o644)) {
		created.push('pubkey.hex');
		if (status === 'present') status = 'published';
	}
} else if (onDiskPubHex.trim().toLowerCase() !== pubkeyHex) {
	mismatch = true;
} else {
	existing.push('pubkey.hex');
}

// npub — tracked, one line, bech32
const onDiskNpub = readText(npubPath);
if (onDiskNpub === null) {
	if (writeOnce(npubPath, npub + '\n', 0o644)) {
		created.push('npub');
		if (status === 'present') status = 'published';
	}
} else if (onDiskNpub.trim() !== npub) {
	mismatch = true;
} else {
	existing.push('npub');
}

// A contradiction between the stored secret and a stored public artifact is
// reported, never repaired: choosing which one is "right" is rotation, and
// rotation is a deliberate act by the key's owner.
if (mismatch && status === 'present') status = 'mismatch';

process.stdout.write(JSON.stringify({
	status: mismatch ? 'mismatch' : status,
	npub: npub,
	created: created,
	existing: existing,
	mismatch: mismatch
}) + '\n');

process.exit(mismatch ? 3 : 0);
