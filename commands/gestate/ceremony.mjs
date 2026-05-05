#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ceremony.mjs — entity gestation key ceremony for koad-io gestate
//
// This file re-exports the migrate-entity ceremony, which contains all the
// key generation and sigchain signing commands needed by gestate. Both
// commands share the same cryptographic primitives:
//
//   generate-entity --userid "<name> @ <domain>"
//   verify-leaf --sovereign-leaf-encrypted-path <path> --sovereign-device-key-path <path>
//   sign-entity-entries --entity-handle ... --entity-fingerprint ... etc.
//
// Rather than duplicating the ceremony, gestate delegates to the shared
// implementation at commands/migrate-entity/ceremony.mjs. New gestation-
// specific commands (if any future spec amendment requires them) can be
// added here as a wrapper around the shared ceremony or as new switch cases.
//
// Ref: VESTA-SPEC-002 v1.3 — canonical gestation protocol (Step 3)
// Ref: VESTA-SPEC-175 §7 — sovereign-signed entity key flow
// Ref: commands/migrate-entity/ceremony.mjs — shared implementation

import { fileURLToPath } from 'url';
import path from 'path';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve the shared ceremony — one level up (commands/), then into migrate-entity/
const SHARED_CEREMONY = path.resolve(__dirname, '..', 'migrate-entity', 'ceremony.mjs');

// Re-execute the shared ceremony with the same argv so all commands are available.
// We use a dynamic import with process.argv intact — the shared ceremony reads
// process.argv[2] onward for command dispatch, so this just hands off transparently.
await import(SHARED_CEREMONY);
