// SPDX-License-Identifier: AGPL-3.0-or-later
//
// entry-renderers.js — Per-type rendering definitions for SPEC-111 sigchain entry types.
//
// Each renderer provides:
//   icon(entry)        → string icon (emoji or text symbol)
//   label(entry)       → short human-readable label
//   description(entry) → full human-readable sentence
//   link(entry)        → optional URL string or null
//
// New entry types: call ActivityStream.registerRenderer(type, renderer) from any package.
// Core types are registered here at module load time.
//
// Relies on ActivityStream.registerRenderer, which is defined in stream.js.
// stream.js is loaded before this file per package.js addFiles ordering.

(function registerCoreRenderers() {

  // ── koad.genesis ───────────────────────────────────────────────────────────

  ActivityStream.registerRenderer('koad.genesis', {
    icon: () => '⊕',
    label: () => 'Chain genesis',
    description: (e) => {
      const entity = e.entity || 'unknown';
      const desc = (e.payload && e.payload.description) || `${entity} sovereign state chain`;
      return `${entity} established: ${desc}`;
    },
    link: () => null,
  });

  // ── koad.bond ──────────────────────────────────────────────────────────────

  ActivityStream.registerRenderer('koad.bond', {
    icon: () => '⛓',
    label: (e) => {
      const action = e.payload && e.payload.action;
      return action === 'revoked' ? 'Bond revoked' : 'Bond filed';
    },
    description: (e) => {
      const p = e.payload || {};
      const action = p.action || 'updated';
      const from = p.from || 'unknown';
      const to = p.to || 'unknown';
      const type = p.bond_type || 'bond';
      return `${from} ${action} a ${type} bond with ${to}`;
    },
    link: (e) => {
      const cid = e.payload && e.payload.bond_cid;
      return cid ? `/ipfs/${cid}` : null;
    },
  });

  // ── koad.release ───────────────────────────────────────────────────────────

  ActivityStream.registerRenderer('koad.release', {
    icon: () => '⬆',
    label: () => 'Release',
    description: (e) => {
      const p = e.payload || {};
      const pkg = p.package || 'unknown';
      const ver = p.version || '?';
      const notes = p.notes ? ` — ${p.notes}` : '';
      return `${pkg} v${ver} released${notes}`;
    },
    link: (e) => {
      const p = e.payload || {};
      return p.url || (p.cid ? `/ipfs/${p.cid}` : null);
    },
  });

  // ── koad.key-rotation ──────────────────────────────────────────────────────

  ActivityStream.registerRenderer('koad.key-rotation', {
    icon: () => '↻',
    label: () => 'Key rotation',
    description: (e) => {
      const p = e.payload || {};
      const reason = p.reason || 'routine';
      const entity = e.entity || 'unknown';
      return `${entity} rotated signing key (${reason})`;
    },
    link: () => null,
  });

  // ── koad.gestation ─────────────────────────────────────────────────────────

  ActivityStream.registerRenderer('koad.gestation', {
    icon: () => '✦',
    label: () => 'Gestation',
    description: (e) => {
      const p = e.payload || {};
      const entity = e.entity || 'unknown';
      const gestated = p.gestated_entity || 'unknown';
      const type = p.entity_type || 'entity';
      return `${entity} gestated ${type}: ${gestated}`;
    },
    link: () => null,
  });

  // ── koad.state-update ──────────────────────────────────────────────────────

  ActivityStream.registerRenderer('koad.state-update', {
    icon: () => '◎',
    label: (e) => {
      const scope = e.payload && e.payload.scope;
      return scope ? `State updated (${scope})` : 'State updated';
    },
    description: (e) => {
      const p = e.payload || {};
      const entity = e.entity || 'unknown';
      const scope = p.scope || 'unknown';
      return `${entity} updated ${scope} state`;
    },
    link: () => null,
  });

  // ── koad.device-key-add ────────────────────────────────────────────────────

  ActivityStream.registerRenderer('koad.device-key-add', {
    icon: () => '+',
    label: () => 'Device key added',
    description: (e) => {
      const p = e.payload || {};
      const entity = e.entity || 'unknown';
      const device = p.device_description || p.device_id || 'unknown device';
      return `${entity} authorized device key: ${device}`;
    },
    link: () => null,
  });

  // ── koad.device-key-revoke ─────────────────────────────────────────────────

  ActivityStream.registerRenderer('koad.device-key-revoke', {
    icon: () => 'x',
    label: () => 'Device key revoked',
    description: (e) => {
      const p = e.payload || {};
      const entity = e.entity || 'unknown';
      const device = p.device_id || 'unknown device';
      const reason = p.reason ? ` (${p.reason})` : '';
      return `${entity} revoked device key: ${device}${reason}`;
    },
    link: () => null,
  });

  // ── default fallback ───────────────────────────────────────────────────────

  ActivityStream.registerRenderer('*', {
    icon: () => '·',
    label: (e) => e.type || 'unknown',
    description: (e) => {
      const entity = e.entity || 'unknown';
      const type = e.type || 'unknown';
      return `${entity}: ${type}`;
    },
    link: () => null,
  });

})();
