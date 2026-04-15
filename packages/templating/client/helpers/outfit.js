// Outfit helpers for koad:io-templating — VESTA-SPEC-063 + VESTA-SPEC-099
// Registered as global Blaze helpers. All are pure functions over the outfit
// object from passenger.json (already normalized by entity-loader).
//
// Usage:
//   {{outfitCssVars outfit}}         -- :root { --entity-* } block (raw HTML)
//   {{outfitHsl outfit 50}}          -- "hsl(h, s%, L%)" string
//   {{outfitL0 outfit}}              -- "h=29 s=54" palette string
//   {{outfitChip outfit name}}       -- <span class="entity-chip"> markup
//   {{outfitCard outfit name role}}  -- <div class="entity-card"> L2 capsule
//   {{outfitStyle outfit}}           -- "background-color: hsl(...)" inline style

import { Template } from 'meteor/templating';
import { Spacebars } from 'meteor/spacebars';

// ---------------------------------------------------------------------------
// Internal: normalize an outfit value coming from a Blaze helper call.
// Accepts the raw outfit object or falls back to palette-zero.
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

// ---------------------------------------------------------------------------
// outfitCssVars — emit a <style> block with :root { --entity-* } vars.
// Returns Spacebars.SafeString so Blaze does not double-escape the HTML.
//
// Usage: {{{outfitCssVars outfit}}}   (triple-stache — raw HTML output)
// ---------------------------------------------------------------------------
Template.registerHelper('outfitCssVars', function(outfit) {
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
  return new Spacebars.SafeString(
    `<style>:root {\n${lines.join('\n')}\n}</style>`
  );
});

// ---------------------------------------------------------------------------
// outfitHsl — return an HSL color string with caller-supplied lightness.
//
// Usage: {{outfitHsl outfit 50}}   →  "hsl(29, 54%, 50%)"
//        {{outfitHsl outfit}}      →  uses default lightness of 50
// ---------------------------------------------------------------------------
Template.registerHelper('outfitHsl', function(outfit, lightness) {
  const o = normalizeOutfit(outfit);
  const L = (typeof lightness === 'number') ? lightness : 50;
  return `hsl(${o.h}, ${o.s}%, ${L}%)`;
});

// ---------------------------------------------------------------------------
// outfitL0 — palette string for logging/debug/terminal contexts.
//
// Usage: {{outfitL0 outfit}}   →  "h=29 s=54"
// ---------------------------------------------------------------------------
Template.registerHelper('outfitL0', function(outfit) {
  const o = normalizeOutfit(outfit);
  return `h=${o.h} s=${o.s}`;
});

// ---------------------------------------------------------------------------
// outfitStyle — inline style string for background-color.
//
// Usage: <div style="{{outfitStyle outfit}}">
//        →  style="background-color: hsl(29, 54%, 50%)"
// ---------------------------------------------------------------------------
Template.registerHelper('outfitStyle', function(outfit, lightness) {
  const o = normalizeOutfit(outfit);
  const L = (typeof lightness === 'number') ? lightness : 50;
  return `background-color: hsl(${o.h}, ${o.s}%, ${L}%)`;
});

// ---------------------------------------------------------------------------
// outfitChip — minimal identity chip (L1 capsule: name + color swatch).
// Returns a safe HTML <span> with inline color.
//
// Usage: {{{outfitChip outfit name}}}
// ---------------------------------------------------------------------------
Template.registerHelper('outfitChip', function(outfit, name) {
  const o = normalizeOutfit(outfit);
  const label = (typeof name === 'string') ? name : (o.name || '');
  const bg = `hsl(${o.h}, ${o.s}%, 45%)`;
  return new Spacebars.SafeString(
    `<span class="entity-chip" style="background-color:${bg};color:#fff;padding:2px 8px;border-radius:3px;font-size:0.85em;">${label}</span>`
  );
});

// ---------------------------------------------------------------------------
// outfitCard — L2 identity card (name + color + role one-liner).
// Returns a safe HTML <div>.
//
// Usage: {{{outfitCard outfit name role}}}
// ---------------------------------------------------------------------------
Template.registerHelper('outfitCard', function(outfit, name, role) {
  const o = normalizeOutfit(outfit);
  const label = (typeof name === 'string') ? name : '';
  const roleStr = (typeof role === 'string') ? role : '';
  const bg = `hsl(${o.h}, ${o.s}%, 40%)`;
  const accent = `hsl(${o.h}, ${o.s}%, 90%)`;

  let inner = `<strong style="color:#fff;">${label}</strong>`;
  if (roleStr) inner += `<br><small style="color:${accent};">${roleStr}</small>`;
  if (o.greeting) inner += `<br><em style="color:${accent};opacity:0.85;">${o.greeting}</em>`;

  return new Spacebars.SafeString(
    `<div class="entity-card" style="background-color:${bg};padding:12px 16px;border-radius:6px;margin:4px 0;">${inner}</div>`
  );
});
