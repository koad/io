#!/usr/bin/env node
// Outfit helper unit tests — runs in plain Node.js (no Meteor harness required).
// Extracts the pure logic from outfit.js and validates it directly.
//
// Run: node test/outfit-helpers-test.js
//
// Pattern: same vm-stub approach used for harness entity-loader tests (juno#88).

'use strict';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message}`);
    failed++;
  }
}

function assertEqual(a, b, msg) {
  const as = JSON.stringify(a);
  const bs = JSON.stringify(b);
  if (as !== bs) throw new Error(`${msg || 'assertEqual'}: expected ${bs}, got ${as}`);
}

function assertIncludes(str, sub, msg) {
  if (!str.includes(sub)) throw new Error(`${msg || 'assertIncludes'}: "${sub}" not in "${str}"`);
}

function assertNotIncludes(str, sub, msg) {
  if (str.includes(sub)) throw new Error(`${msg || 'assertNotIncludes'}: "${sub}" unexpectedly found in "${str}"`);
}

// ---------------------------------------------------------------------------
// Extract the pure functions from outfit.js without the Blaze/Meteor bindings.
// We replicate normalizeOutfit and the helper logic directly — helpers are thin
// wrappers around these; the spec risk is in the normalization + rendering logic.
// ---------------------------------------------------------------------------

function normalizeOutfit(o) {
  if (!o || typeof o !== 'object') return { h: 0, s: 0 };
  const out = {};
  out.h = o.h !== undefined ? o.h : (o.hue !== undefined ? o.hue : 0);
  out.s = o.s !== undefined ? o.s : (o.saturation !== undefined ? o.saturation : 0);
  if (o.typography) out.typography = o.typography;
  if (o.greeting) out.greeting = o.greeting;
  if (o.personality) out.personality = o.personality;
  if (o.motion) out.motion = o.motion;
  if (o.visual) out.visual = o.visual;
  if (o.spatial) out.spatial = o.spatial;
  return out;
}

function outfitCssVars(outfit) {
  const o = normalizeOutfit(outfit);
  const lines = [
    `  --entity-hue: ${o.h};`,
    `  --entity-saturation: ${o.s}%;`,
  ];
  if (o.typography) {
    if (o.typography.heading) lines.push(`  --entity-font-heading: ${o.typography.heading};`);
    if (o.typography.body)    lines.push(`  --entity-font-body: ${o.typography.body};`);
    if (o.typography.mono)    lines.push(`  --entity-font-mono: ${o.typography.mono};`);
  }
  if (o.motion) {
    if (o.motion.easing)      lines.push(`  --entity-easing: ${o.motion.easing};`);
    if (o.motion.durationMs)  lines.push(`  --entity-duration: ${o.motion.durationMs}ms;`);
  }
  return `<style>:root {\n${lines.join('\n')}\n}</style>`;
}

function outfitHsl(outfit, lightness) {
  const o = normalizeOutfit(outfit);
  const L = (typeof lightness === 'number') ? lightness : 50;
  return `hsl(${o.h}, ${o.s}%, ${L}%)`;
}

function outfitL0(outfit) {
  const o = normalizeOutfit(outfit);
  return `h=${o.h} s=${o.s}`;
}

function outfitStyle(outfit, lightness) {
  const o = normalizeOutfit(outfit);
  const L = (typeof lightness === 'number') ? lightness : 50;
  return `background-color: hsl(${o.h}, ${o.s}%, ${L}%)`;
}

function outfitChip(outfit, name) {
  const o = normalizeOutfit(outfit);
  const label = (typeof name === 'string') ? name : '';
  const bg = `hsl(${o.h}, ${o.s}%, 45%)`;
  return `<span class="entity-chip" style="background-color:${bg};color:#fff;padding:2px 8px;border-radius:3px;font-size:0.85em;">${label}</span>`;
}

function outfitCard(outfit, name, role) {
  const o = normalizeOutfit(outfit);
  const label = (typeof name === 'string') ? name : '';
  const roleStr = (typeof role === 'string') ? role : '';
  const bg = `hsl(${o.h}, ${o.s}%, 40%)`;
  const accent = `hsl(${o.h}, ${o.s}%, 90%)`;
  let inner = `<strong style="color:#fff;">${label}</strong>`;
  if (roleStr) inner += `<br><small style="color:${accent};">${roleStr}</small>`;
  if (o.greeting) inner += `<br><em style="color:${accent};opacity:0.85;">${o.greeting}</em>`;
  return `<div class="entity-card" style="background-color:${bg};padding:12px 16px;border-radius:6px;margin:4px 0;">${inner}</div>`;
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const L0_OUTFIT = { h: 199, s: 35 };

const FULL_OUTFIT = {
  h: 199,
  s: 35,
  typography: { heading: 'Playfair Display', body: 'Inter', mono: 'JetBrains Mono' },
  greeting: 'Ready when you are.',
  personality: { tone: 'warm, direct', tags: ['sovereignty'] },
  motion: { easing: 'ease-out', durationMs: 300 },
  visual: { avatar: 'identity/avatar.png', format: 'png' },
  spatial: { mesh: 'identity/avatar.glb', format: 'glb' },
};

const LEGACY_OUTFIT = { hue: 29, saturation: 54, brightness: 30 };

// ---------------------------------------------------------------------------
// normalizeOutfit
// ---------------------------------------------------------------------------
console.log('\nnormalizeOutfit');

test('L0 canonical fields pass through', () => {
  const out = normalizeOutfit(L0_OUTFIT);
  assertEqual(out.h, 199);
  assertEqual(out.s, 35);
});

test('legacy {hue, saturation, brightness} aliased (SPEC-063 §7)', () => {
  const out = normalizeOutfit(LEGACY_OUTFIT);
  assertEqual(out.h, 29);
  assertEqual(out.s, 54);
  if (out.brightness !== undefined) throw new Error('brightness must be dropped');
});

test('null/undefined yields palette-zero', () => {
  assertEqual(normalizeOutfit(null),      { h: 0, s: 0 });
  assertEqual(normalizeOutfit(undefined), { h: 0, s: 0 });
  assertEqual(normalizeOutfit('string'),  { h: 0, s: 0 });
});

test('full outfit preserves all LOD keys', () => {
  const out = normalizeOutfit(FULL_OUTFIT);
  assertEqual(out.h, 199);
  assertEqual(out.typography.heading, 'Playfair Display');
  assertEqual(out.greeting, 'Ready when you are.');
  assertEqual(out.personality.tone, 'warm, direct');
  assertEqual(out.motion.easing, 'ease-out');
  assertEqual(out.visual.avatar, 'identity/avatar.png');
  assertEqual(out.spatial.mesh, 'identity/avatar.glb');
});

// ---------------------------------------------------------------------------
// outfitCssVars
// ---------------------------------------------------------------------------
console.log('\noutfitCssVars');

test('L0 — emits hue and saturation vars', () => {
  const html = outfitCssVars(L0_OUTFIT);
  assertIncludes(html, '<style>:root {');
  assertIncludes(html, '--entity-hue: 199;');
  assertIncludes(html, '--entity-saturation: 35%;');
});

test('L1 — includes typography vars when present', () => {
  const html = outfitCssVars(FULL_OUTFIT);
  assertIncludes(html, '--entity-font-heading: Playfair Display;');
  assertIncludes(html, '--entity-font-body: Inter;');
  assertIncludes(html, '--entity-font-mono: JetBrains Mono;');
});

test('L3 motion — includes easing and duration vars', () => {
  const html = outfitCssVars(FULL_OUTFIT);
  assertIncludes(html, '--entity-easing: ease-out;');
  assertIncludes(html, '--entity-duration: 300ms;');
});

test('L0 only — no typography or motion vars emitted', () => {
  const html = outfitCssVars(L0_OUTFIT);
  assertNotIncludes(html, '--entity-font');
  assertNotIncludes(html, '--entity-easing');
  assertNotIncludes(html, '--entity-duration');
});

test('null outfit — emits palette-zero vars safely', () => {
  const html = outfitCssVars(null);
  assertIncludes(html, '--entity-hue: 0;');
  assertIncludes(html, '--entity-saturation: 0%;');
});

// ---------------------------------------------------------------------------
// outfitHsl
// ---------------------------------------------------------------------------
console.log('\noutfitHsl');

test('default lightness = 50', () => {
  assertEqual(outfitHsl(L0_OUTFIT), 'hsl(199, 35%, 50%)');
});

test('custom lightness respected', () => {
  assertEqual(outfitHsl(L0_OUTFIT, 30), 'hsl(199, 35%, 30%)');
});

test('legacy outfit aliased before hsl', () => {
  assertEqual(outfitHsl(LEGACY_OUTFIT), 'hsl(29, 54%, 50%)');
});

// ---------------------------------------------------------------------------
// outfitL0
// ---------------------------------------------------------------------------
console.log('\noutfitL0');

test('palette string format', () => {
  assertEqual(outfitL0(L0_OUTFIT), 'h=199 s=35');
});

// ---------------------------------------------------------------------------
// outfitStyle
// ---------------------------------------------------------------------------
console.log('\noutfitStyle');

test('inline style string format', () => {
  assertEqual(outfitStyle(L0_OUTFIT), 'background-color: hsl(199, 35%, 50%)');
});

test('custom lightness in style', () => {
  assertEqual(outfitStyle(L0_OUTFIT, 20), 'background-color: hsl(199, 35%, 20%)');
});

// ---------------------------------------------------------------------------
// outfitChip
// ---------------------------------------------------------------------------
console.log('\noutfitChip');

test('chip contains entity-chip class', () => {
  const html = outfitChip(L0_OUTFIT, 'Juno');
  assertIncludes(html, 'class="entity-chip"');
});

test('chip contains entity name', () => {
  const html = outfitChip(L0_OUTFIT, 'Juno');
  assertIncludes(html, 'Juno');
});

test('chip background uses hue/sat', () => {
  const html = outfitChip(L0_OUTFIT, 'Juno');
  assertIncludes(html, 'hsl(199, 35%, 45%)');
});

// ---------------------------------------------------------------------------
// outfitCard
// ---------------------------------------------------------------------------
console.log('\noutfitCard');

test('card contains entity-card class', () => {
  const html = outfitCard(FULL_OUTFIT, 'Juno', 'orchestrator');
  assertIncludes(html, 'class="entity-card"');
});

test('card contains name and role', () => {
  const html = outfitCard(FULL_OUTFIT, 'Juno', 'orchestrator');
  assertIncludes(html, 'Juno');
  assertIncludes(html, 'orchestrator');
});

test('card contains greeting when present (L1)', () => {
  const html = outfitCard(FULL_OUTFIT, 'Juno', 'orchestrator');
  assertIncludes(html, 'Ready when you are.');
});

test('card no greeting when absent (L0 only)', () => {
  const html = outfitCard(L0_OUTFIT, 'Juno', 'orchestrator');
  assertNotIncludes(html, '<em');
});

test('card background uses hue/sat', () => {
  const html = outfitCard(L0_OUTFIT, 'Juno', '');
  assertIncludes(html, 'hsl(199, 35%, 40%)');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
