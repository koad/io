import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

export const HOME = os.homedir();
export const DEFAULT_BLOCKED = [
  '/.env',
  '/.credentials',
  '/.git/',
  '/id/',
  '/.ssh/',
  '/auth.json',
  '/secrets/',
  '/secret/',
  '/private/',
];

const EMPTY_FILE_SCOPE = {
  read: [],
  write: [],
  exec: [],
  blocked: [...DEFAULT_BLOCKED],
  read_extensions: [],
  write_extensions: [],
  blocked_extensions: [],
};

const EMPTY_TOOL_GRANTS = {
  bash: false,
  dispatch: false,
  dispatch_followup: false,
  dispatch_complete: false,
  koadio_tools: [],
  koadio_commands: [],
  channels: { moderate: [], participate: [] },
};

const EMPTY_ENTITY_CAPS = {
  dispatch_targets: [],
  message_targets: [],
  channel_roles: {},
};

const EMPTY_INTERACTIVE = {};

export function currentDeviceId() {
  return os.hostname();
}

export function normalizeFingerprint(raw) {
  const normalized = raw?.replace(/\s+/g, '').trim().toLowerCase();
  return normalized || undefined;
}

export function expandPath(raw) {
  if (raw === '~') return HOME;
  if (raw.startsWith('~/')) return path.join(HOME, raw.slice(2));
  return path.resolve(raw);
}

export function resolveToolPath(raw, cwd = process.cwd()) {
  if (raw === '~') return HOME;
  if (raw.startsWith('~/')) return path.join(HOME, raw.slice(2));
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(cwd, raw);
}

export function isUnder(absolutePath, prefixes) {
  return prefixes.some(prefix => {
    const resolved = path.resolve(prefix);
    const relative = path.relative(resolved, absolutePath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  });
}

export function isBlocked(absolutePath, blocked) {
  const normalized = absolutePath + '/';
  return blocked.some(pattern => normalized.includes(pattern));
}

export function fileExtension(absolutePath) {
  const base = path.basename(absolutePath);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot).toLowerCase();
}

export function isExtensionAllowed(absolutePath, allowedExtensions) {
  if (allowedExtensions.length === 0) return true;
  const ext = fileExtension(absolutePath);
  return allowedExtensions.some(a => a.toLowerCase() === ext);
}

export function isExtensionBlocked(absolutePath, blockedExtensions) {
  if (blockedExtensions.length === 0) return false;
  const ext = fileExtension(absolutePath);
  return blockedExtensions.some(a => a.toLowerCase() === ext);
}

export function parsePathList(raw) {
  if (!raw) return [];
  return raw.split(':').map(s => s.trim()).filter(Boolean).map(expandPath);
}

export function parseNameList(raw) {
  if (!raw) return [];
  return raw.split(/[\s,:]+/).map(s => s.trim()).filter(Boolean);
}

function envFlag(...names) {
  return names.some(name => /^(1|true|yes|on)$/i.test(process.env[name] ?? ''));
}

function yamlAtom(value) {
  return value.trim().replace(/^['"]|['"]$/g, '');
}

function parseYamlList(block, key) {
  const keyPattern = new RegExp(`^\\s*${key}:\\s*(.*)$`, 'm');
  const match = block.match(keyPattern);
  if (!match) return [];

  const inlineValue = match[1].trim();
  if (inlineValue === '[]') return [];
  if (inlineValue.startsWith('[')) {
    return inlineValue.slice(1, -1).split(',').map(yamlAtom).filter(Boolean);
  }
  if (inlineValue) return [yamlAtom(inlineValue)];

  const lines = block.split('\n');
  const keyLineIdx = lines.findIndex(l => keyPattern.test(l));
  if (keyLineIdx === -1) return [];

  const items = [];
  for (let i = keyLineIdx + 1; i < lines.length; i++) {
    const itemMatch = lines[i].match(/^\s+-\s+(.+)$/);
    if (itemMatch) items.push(yamlAtom(itemMatch[1]));
    else if (lines[i].match(/^\s+\S+:/)) break;
    else if (lines[i].trim() === '') continue;
    else break;
  }
  return items;
}

function parseYamlBool(block, key) {
  const pattern = new RegExp(`^\\s*${key}:\\s*(.+)$`, 'm');
  const match = block.match(pattern);
  if (!match) return undefined;
  const val = match[1].trim().toLowerCase();
  if (val === 'true' || val === 'yes') return true;
  if (val === 'false' || val === 'no') return false;
  return undefined;
}

function parseYamlString(block, key) {
  const pattern = new RegExp(`^\\s*${key}:\\s*(.+)$`, 'm');
  const match = block.match(pattern);
  if (!match) return undefined;
  return yamlAtom(match[1]);
}

function parseYamlStringMap(block, key) {
  const map = {};
  const keyPattern = new RegExp(`^\\s*${key}:`);
  const lines = block.split('\n');
  const startIdx = lines.findIndex(l => keyPattern.test(l));
  if (startIdx === -1) return map;

  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    const mapMatch = line.match(/^\s+(\S[^:]*):\s*(.+)$/);
    if (mapMatch) map[yamlAtom(mapMatch[1])] = yamlAtom(mapMatch[2]);
    else if (line.match(/^\s+\S+:/)) break;
    else if (line.trim() === '') continue;
    else break;
  }
  return map;
}

function extractYamlBlock(fm, key) {
  if (!fm.includes(`${key}:`)) return undefined;
  const start = fm.indexOf(`${key}:`);
  const after = fm.slice(start);
  const lines = after.split('\n');
  let block = lines[0] + '\n';
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].match(/^\S/) && lines[i].includes(':')) break;
    block += lines[i] + '\n';
  }
  return block;
}

function parseYamlDeviceGrants(fm) {
  const devices = {};
  const devBlock = extractYamlBlock(fm, 'devices');
  if (!devBlock) return devices;

  const lines = devBlock.split('\n');
  let currentHost = null;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const hostMatch = line.match(/^\s{2}([a-zA-Z0-9_-]+):\s*$/);
    if (hostMatch) {
      currentHost = hostMatch[1];
      devices[currentHost] = { allow: false };
      continue;
    }
    if (!currentHost) continue;
    const propMatch = line.match(/^\s{4}([a-zA-Z_]+):\s*(.+)$/);
    if (!propMatch) continue;
    const [, key, rawValue] = propMatch;
    const val = yamlAtom(rawValue);

    if (key === 'allow') {
      devices[currentHost].allow = /^(true|yes)$/i.test(val);
    } else if (key === 'label') {
      devices[currentHost].label = val;
    }
  }
  return devices;
}

function extractClearsignedBody(content) {
  return content
    .replace(/^-----BEGIN PGP SIGNED MESSAGE-----\s*/m, '')
    .replace(/^-----BEGIN PGP SIGNATURE-----[\s\S]*$/m, '')
    .replace(/^Hash:.*\n/m, '')
    .replace(/^(\s*)- (?=-)/gm, '$1')
    .trim();
}

function extractFrontmatter(body) {
  return body.match(/^---\s*\n([\s\S]*?)\n---/)?.[1];
}

function readFingerprintFile(filePath) {
  try {
    return normalizeFingerprint(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return undefined;
  }
}

function isSovereignIssuer(from) {
  return String(from ?? '').toLowerCase().trim() === 'koad';
}

function expectedFingerprintForIssuer(from, fromFingerprint) {
  // ── Sovereign tier ─────────────────────────────────────────────────────────
  // A bond that claims to be from the sovereign must be signed by the
  // sovereign's key. Resolved ONLY from the environment — never from the bond's
  // own frontmatter, which is attacker-controlled. Without this tier, any entity
  // can write `from: koad` with a `from_fingerprint` of its own choosing and sign
  // it with its own key, forging full kingdom scope. (Found 2026-09-22; this is
  // the logic the harness extension's parse.ts already had.)
  if (isSovereignIssuer(from)) {
    return normalizeFingerprint(process.env.SOVEREIGN_FINGERPRINT);
  }

  // ── Entity tier ────────────────────────────────────────────────────────────
  const explicit = normalizeFingerprint(fromFingerprint);
  if (explicit) return explicit;
  const entityPaths = [
    path.join(HOME, `.${from}`, 'id', 'entity.fingerprint'),
    path.join(HOME, `.${from}`, 'id', 'master.fingerprint'),
  ];
  for (const candidate of entityPaths) {
    const fingerprint = readFingerprintFile(candidate);
    if (fingerprint) return fingerprint;
  }
  return undefined;
}

function describeVerifyFailure(output, status) {
  if (/NO_PUBKEY/.test(output)) return 'public key not in keyring';
  if (/BADSIG/.test(output)) return 'bad signature';
  if (/ERRSIG/.test(output)) return 'signature verification failed';
  if (/NODATA/.test(output)) return 'not a signed bond file';
  if (status === 124) return 'verification timed out';
  return `gpg verify exited ${status ?? 'unknown'}`;
}

export function verifyBondSignature(filePath, declaredFrom, fromFingerprint) {
  const verify = spawnSync('gpg', ['--no-tty', '--status-fd=1', '--verify', filePath], {
    env: process.env,
    encoding: 'utf8',
    timeout: 5000,
  });
  const output = `${verify.stdout ?? ''}\n${verify.stderr ?? ''}`;
  const fingerprint = normalizeFingerprint(output.match(/\[GNUPG:\]\s+VALIDSIG\s+(\S+)/)?.[1]);
  const goodSig = output.match(/\[GNUPG:\]\s+GOODSIG\s+(\S+)\s+(.+)/);
  const keyId = normalizeFingerprint(goodSig?.[1]) ?? fingerprint?.slice(-16);
  const signer = goodSig?.[2]?.trim() || declaredFrom;
  const expectedFingerprint = expectedFingerprintForIssuer(declaredFrom, fromFingerprint);

  if (verify.status !== 0 || !fingerprint) {
    return { valid: false, signer, keyId, fingerprint, expectedFingerprint, reason: describeVerifyFailure(output, verify.status) };
  }

  // Fail closed. A sovereign bond whose sovereign fingerprint cannot be resolved
  // must never validate. Checked before the comparison below, because that
  // comparison is skipped when `expectedFingerprint` is falsy — so an unset
  // SOVEREIGN_FINGERPRINT would otherwise let ANY signature pass as sovereign.
  if (isSovereignIssuer(declaredFrom) && !expectedFingerprint) {
    return {
      valid: false,
      signer,
      keyId,
      fingerprint,
      expectedFingerprint,
      reason: 'SOVEREIGN_FINGERPRINT is not set — cannot verify a sovereign bond (failing closed; set it in ~/.koad-io/.env)',
    };
  }

  if (expectedFingerprint && fingerprint !== expectedFingerprint) {
    return {
      valid: false,
      signer,
      keyId,
      fingerprint,
      expectedFingerprint,
      reason: `signed by ${fingerprint.slice(0, 16)}… but ${declaredFrom} expects ${expectedFingerprint.slice(0, 16)}…`,
    };
  }

  return { valid: true, signer, keyId, fingerprint, expectedFingerprint };
}

export function parseBonds(entity) {
  const bondsDir = path.join(HOME, `.${entity}`, 'trust', 'bonds');
  const bonds = [];
  const errors = [];
  let entries;
  try {
    entries = fs.readdirSync(bondsDir);
  } catch {
    return { bonds: [], errors: [] };
  }

  const unsigned = entries.filter(e => e.endsWith('.md') && !e.endsWith('.md.asc') && !entries.includes(e + '.asc'));
  for (const u of unsigned) errors.push(`unsigned bond: ${u} (needs .md.asc — bare .md files ignored)`);

  for (const entry of entries) {
    if (!entry.endsWith('.md.asc')) continue;
    const bondPath = path.join(bondsDir, entry);
    try {
      const content = fs.readFileSync(bondPath, 'utf8');
      const body = extractClearsignedBody(content);
      const fm = extractFrontmatter(body);
      if (!fm) {
        errors.push(`bond parse error: ${entry} — unreadable or malformed frontmatter`);
        continue;
      }

      const type = parseYamlString(fm, 'type') ?? 'unknown';
      const from = parseYamlString(fm, 'from') ?? '';
      const fromFp = parseYamlString(fm, 'from_fingerprint');
      const to = parseYamlString(fm, 'to') ?? '';
      const status = parseYamlString(fm, 'status') ?? 'ACTIVE';
      const visibility = parseYamlString(fm, 'visibility') ?? 'private';
      const created = parseYamlString(fm, 'created');
      const expires = parseYamlString(fm, 'expires');
      const renewal = parseYamlString(fm, 'renewal');
      const device_ids = parseYamlList(fm, 'device_ids');

      const verification = verifyBondSignature(bondPath, from, fromFp);
      if (!verification.valid) {
        errors.push(`bond rejected: ${entry} — ${verification.reason ?? 'invalid signature'}`);
        continue;
      }

      const capBlock = extractYamlBlock(fm, 'capabilities');
      const capabilities = capBlock ? {
        read: parseYamlList(capBlock, 'read').map(expandPath),
        write: parseYamlList(capBlock, 'write').map(expandPath),
        exec: parseYamlList(capBlock, 'exec').map(expandPath),
        blocked: parseYamlList(capBlock, 'blocked'),
        read_extensions: parseYamlList(capBlock, 'read_extensions'),
        write_extensions: parseYamlList(capBlock, 'write_extensions'),
        blocked_extensions: parseYamlList(capBlock, 'blocked_extensions'),
      } : structuredClone(EMPTY_FILE_SCOPE);

      const toolsBlock = extractYamlBlock(fm, 'tools');
      const tools = toolsBlock ? {
        bash: parseYamlBool(toolsBlock, 'bash') ?? false,
        dispatch: parseYamlBool(toolsBlock, 'dispatch') ?? false,
        dispatch_followup: parseYamlBool(toolsBlock, 'dispatch_followup') ?? false,
        dispatch_complete: parseYamlBool(toolsBlock, 'dispatch_complete') ?? false,
        koadio_tools: parseYamlList(toolsBlock, 'koadio_tools'),
        koadio_commands: parseYamlList(toolsBlock, 'koadio_commands'),
        channels: {
          moderate: parseYamlList(toolsBlock, 'moderate'),
          participate: parseYamlList(toolsBlock, 'participate'),
        },
      } : structuredClone(EMPTY_TOOL_GRANTS);

      const ecBlock = extractYamlBlock(fm, 'entity_capabilities');
      const entity_capabilities = ecBlock ? {
        dispatch_targets: parseYamlList(ecBlock, 'dispatch_targets'),
        message_targets: parseYamlList(ecBlock, 'message_targets'),
        channel_roles: parseYamlStringMap(ecBlock, 'channel_roles'),
      } : structuredClone(EMPTY_ENTITY_CAPS);

      const intBlock = extractYamlBlock(fm, 'interactive');
      const interactive = intBlock ? {
        bash: parseYamlBool(intBlock, 'bash'),
        exec: parseYamlList(intBlock, 'exec').map(expandPath),
        write: parseYamlList(intBlock, 'write').map(expandPath),
      } : structuredClone(EMPTY_INTERACTIVE);

      const specRefs = parseYamlList(fm, 'spec-refs');
      const reason = parseYamlString(fm, 'reason');
      const devices = parseYamlDeviceGrants(fm);

      bonds.push({
        type, from, from_fingerprint: fromFp, to, status, visibility,
        created, expires, renewal,
        capabilities, tools, entity_capabilities, interactive,
        device_ids, devices, path: bondPath, specRefs, reason,
      });
    } catch {
      errors.push(`bond parse error: ${entry} — unreadable or malformed frontmatter`);
    }
  }

  return { bonds, errors };
}

export function effectiveBonds(entity) {
  const { bonds: all, errors } = parseBonds(entity);
  const deviceId = currentDeviceId();
  const active = all.filter(b => {
    if (b.status !== 'ACTIVE') return false;
    if (b.expires) {
      const expiry = new Date(b.expires);
      if (!Number.isNaN(expiry.getTime()) && expiry < new Date()) return false;
    }
    if (b.to !== entity && b.to !== '*') return false;
    return b.device_ids.length === 0 || b.device_ids.includes(deviceId);
  });
  return { bonds: active, errors };
}

function pushUnique(target, values) {
  for (const value of values) if (!target.includes(value)) target.push(value);
}

function applyEnvLanes(scope) {
  if (scope.fatal) return scope;
  const envRead = parsePathList(process.env.KOAD_IO_HARNESS_READ_PATHS);
  const envWrite = parsePathList(process.env.KOAD_IO_HARNESS_WRITE_PATHS);
  const envExec = parsePathList(process.env.KOAD_IO_HARNESS_EXEC_PATHS);
  const envBlocked = parseNameList(process.env.KOAD_IO_HARNESS_BLOCKED_PATTERNS);
  const envReadExtensions = parseNameList(process.env.KOAD_IO_HARNESS_READ_EXTENSIONS ?? process.env.KOAD_IO_PI_HARNESS_READ_EXTENSIONS);
  const envWriteExtensions = parseNameList(process.env.KOAD_IO_HARNESS_WRITE_EXTENSIONS ?? process.env.KOAD_IO_PI_HARNESS_WRITE_EXTENSIONS);
  const envBlockedExtensions = parseNameList(process.env.KOAD_IO_HARNESS_BLOCKED_EXTENSIONS ?? process.env.KOAD_IO_PI_HARNESS_BLOCKED_EXTENSIONS);
  const envKoadioCommands = [
    ...parseNameList(process.env.KOAD_IO_BOND_GATE_ALLOW_KOADIO_COMMANDS),
    ...parseNameList(process.env.KOAD_IO_PI_BOND_GATE_ALLOW_KOADIO_COMMANDS),
  ];

  const next = structuredClone(scope);
  const lanes = [];
  if (envRead.length) { pushUnique(next.file.read, envRead); lanes.push(`read+${envRead.length}`); }
  if (envWrite.length) { pushUnique(next.file.write, envWrite); lanes.push(`write+${envWrite.length}`); }
  if (envExec.length) { pushUnique(next.file.exec, envExec); lanes.push(`exec+${envExec.length}`); }
  if (envBlocked.length) { pushUnique(next.file.blocked, envBlocked); lanes.push(`blocked+${envBlocked.length}`); }
  if (envReadExtensions.length) { pushUnique(next.file.read_extensions, envReadExtensions); lanes.push(`read-ext+${envReadExtensions.length}`); }
  if (envWriteExtensions.length) { pushUnique(next.file.write_extensions, envWriteExtensions); lanes.push(`write-ext+${envWriteExtensions.length}`); }
  if (envBlockedExtensions.length) { pushUnique(next.file.blocked_extensions, envBlockedExtensions); lanes.push(`blocked-ext+${envBlockedExtensions.length}`); }
  if (envKoadioCommands.length) { pushUnique(next.tools.koadio_commands, envKoadioCommands); lanes.push(`commands+${envKoadioCommands.length}`); }
  if (envFlag('KOAD_IO_BOND_GATE_ALLOW_BASH', 'KOAD_IO_PI_BOND_GATE_ALLOW_BASH')) { next.tools.bash = true; lanes.push('bash'); }
  if (envFlag('KOAD_IO_BOND_GATE_ALLOW_DISPATCH', 'KOAD_IO_PI_BOND_GATE_ALLOW_DISPATCH')) { next.tools.dispatch = true; lanes.push('dispatch'); }
  if (!lanes.length) return scope;

  next.envLanes = [...(scope.envLanes ?? []), ...lanes];
  next.label = `${scope.label} + env(${lanes.join(', ')})`;
  if (next.mode === 'default') next.mode = 'env-var';
  return next;
}

export function mergeBondScope(entity, bonds, errors, interactive = false) {
  const deviceId = currentDeviceId();
  const file = structuredClone(EMPTY_FILE_SCOPE);
  const tools = structuredClone(EMPTY_TOOL_GRANTS);
  const entity_capabilities = structuredClone(EMPTY_ENTITY_CAPS);
  const intOverride = structuredClone(EMPTY_INTERACTIVE);
  const devices = {};

  for (const b of bonds) {
    pushUnique(file.read, b.capabilities.read);
    pushUnique(file.write, b.capabilities.write);
    pushUnique(file.exec, b.capabilities.exec);
    pushUnique(file.blocked, b.capabilities.blocked);
    pushUnique(file.read_extensions, b.capabilities.read_extensions);
    pushUnique(file.write_extensions, b.capabilities.write_extensions);
    pushUnique(file.blocked_extensions, b.capabilities.blocked_extensions);

    if (b.tools.bash) tools.bash = true;
    if (b.tools.dispatch) tools.dispatch = true;
    if (b.tools.dispatch_followup) tools.dispatch_followup = true;
    if (b.tools.dispatch_complete) tools.dispatch_complete = true;
    pushUnique(tools.koadio_tools, b.tools.koadio_tools);
    pushUnique(tools.koadio_commands, b.tools.koadio_commands);
    pushUnique(tools.channels.moderate, b.tools.channels.moderate);
    pushUnique(tools.channels.participate, b.tools.channels.participate);

    pushUnique(entity_capabilities.dispatch_targets, b.entity_capabilities.dispatch_targets);
    pushUnique(entity_capabilities.message_targets, b.entity_capabilities.message_targets);
    Object.assign(entity_capabilities.channel_roles, b.entity_capabilities.channel_roles);

    if (b.interactive.exec) pushUnique(intOverride.exec ??= [], b.interactive.exec);
    if (b.interactive.write) pushUnique(intOverride.write ??= [], b.interactive.write);
    if (b.interactive.bash !== undefined) intOverride.bash = b.interactive.bash;

    Object.assign(devices, b.devices);
  }

  if (interactive) {
    if (intOverride.bash !== undefined && envFlag('KOAD_IO_BOND_GATE_ALLOW_INTERACTIVE_BASH', 'KOAD_IO_PI_BOND_GATE_ALLOW_INTERACTIVE_BASH')) tools.bash = intOverride.bash;
    if (intOverride.exec && envFlag('KOAD_IO_BOND_GATE_ALLOW_INTERACTIVE_EXEC', 'KOAD_IO_PI_BOND_GATE_ALLOW_INTERACTIVE_EXEC')) pushUnique(file.exec, intOverride.exec);
    if (intOverride.write && envFlag('KOAD_IO_BOND_GATE_ALLOW_INTERACTIVE_WRITE', 'KOAD_IO_PI_BOND_GATE_ALLOW_INTERACTIVE_WRITE')) pushUnique(file.write, intOverride.write);
  }

  const dispatchDir = process.env.HARNESS_WORK_DIR?.trim();
  if (dispatchDir) {
    const expanded = expandPath(dispatchDir);
    if (expanded !== HOME) {
      pushUnique(file.read, [expanded]);
      pushUnique(file.write, [expanded]);
      pushUnique(file.exec, [expanded]);
    }
  }

  return {
    file,
    tools,
    entity_capabilities,
    interactive: intOverride,
    devices,
    errors,
    mode: 'bonded',
    label: `mode=bonded device=${deviceId} bonds=${bonds.length}`,
    bondCount: bonds.length,
    deviceId,
    envLanes: [],
    envReadTools: [],
    envWriteTools: [],
    fatal: false,
  };
}

export function resolveGate(entity, { interactive = false } = {}) {
  const deviceId = currentDeviceId();
  if (envFlag('KOAD_IO_BOND_GATE_BYPASS', 'KOAD_IO_PI_BOND_GATE_BYPASS')) {
    return {
      file: { read: ['/'], write: ['/'], exec: ['/'], blocked: [], read_extensions: [], write_extensions: [], blocked_extensions: [] },
      tools: { bash: true, dispatch: true, dispatch_followup: true, dispatch_complete: true, koadio_tools: ['*'], koadio_commands: ['*'], channels: { moderate: ['*'], participate: ['*'] } },
      entity_capabilities: { dispatch_targets: ['*'], message_targets: ['*'], channel_roles: {} },
      interactive: {},
      devices: {},
      errors: [],
      mode: 'bypass',
      label: 'mode=bypass — ALL ACCESS GRANTED',
      bondCount: 0,
      deviceId,
      envLanes: [],
      envReadTools: [],
      envWriteTools: [],
      fatal: false,
    };
  }

  const { bonds, errors } = effectiveBonds(entity);
  const bondsDir = path.join(HOME, `.${entity}`, 'trust', 'bonds');
  let hasBondFiles = false;
  try { hasBondFiles = fs.readdirSync(bondsDir).some(e => e.endsWith('.md.asc')); } catch {}

  if (hasBondFiles && bonds.length === 0) {
    return {
      file: structuredClone(EMPTY_FILE_SCOPE),
      tools: structuredClone(EMPTY_TOOL_GRANTS),
      entity_capabilities: structuredClone(EMPTY_ENTITY_CAPS),
      interactive: {},
      devices: {},
      errors,
      mode: 'fatal',
      label: 'mode=fatal — bond verification failed',
      bondCount: 0,
      deviceId,
      envLanes: [],
      envReadTools: [],
      envWriteTools: [],
      fatal: true,
      fatalReason: errors.length ? errors.join('; ') : 'bond files present but none could be verified',
    };
  }

  let scope;
  if (bonds.length > 0) {
    scope = mergeBondScope(entity, bonds, errors, interactive);
  } else {
    const dispatchDir = process.env.HARNESS_WORK_DIR?.trim();
    const dispatchExpanded = dispatchDir ? expandPath(dispatchDir) : '';
    if (dispatchDir && dispatchExpanded !== HOME) {
      scope = {
        file: { read: [dispatchExpanded], write: [dispatchExpanded], exec: [dispatchExpanded], blocked: [...DEFAULT_BLOCKED], read_extensions: [], write_extensions: [], blocked_extensions: [] },
        tools: structuredClone(EMPTY_TOOL_GRANTS),
        entity_capabilities: structuredClone(EMPTY_ENTITY_CAPS),
        interactive: {},
        devices: {},
        errors,
        mode: 'env-var',
        label: 'mode=env-var dispatch dir r+w+e',
        bondCount: 0,
        deviceId,
        envLanes: [],
        envReadTools: [],
        envWriteTools: [],
        fatal: false,
      };
    } else {
      scope = {
        file: structuredClone(EMPTY_FILE_SCOPE),
        tools: structuredClone(EMPTY_TOOL_GRANTS),
        entity_capabilities: structuredClone(EMPTY_ENTITY_CAPS),
        interactive: {},
        devices: {},
        errors: dispatchDir && dispatchExpanded === HOME ? [...errors, 'HARNESS_WORK_DIR points at HOME; automatic r+w+e lane skipped'] : errors,
        mode: 'default',
        label: errors.length ? 'mode=default — no valid bonds' : 'mode=default — no bonds, no access',
        bondCount: 0,
        deviceId,
        envLanes: [],
        envReadTools: [],
        envWriteTools: [],
        fatal: false,
      };
    }
  }

  return applyEnvLanes(scope);
}

export function isCommandGranted(scope, commandName, aliases = []) {
  if (scope.fatal) return false;
  const granted = scope.tools?.koadio_commands ?? [];
  if (granted.includes('*')) return true;
  return [commandName, ...aliases].filter(Boolean).some(name => granted.includes(name));
}

export function checkCommand(entity, commandName, { aliases = [], interactive = false } = {}) {
  const scope = resolveGate(entity, { interactive });
  if (scope.fatal) return { ok: false, scope, reason: scope.fatalReason ?? 'bond verification failed' };
  if (isCommandGranted(scope, commandName, aliases)) return { ok: true, scope };
  const requested = [commandName, ...aliases].filter(Boolean).join(', ');
  return { ok: false, scope, reason: `command not granted by bond: ${requested}` };
}

function scopePathsForMode(scope, mode) {
  if (mode === 'read') return scope.file.read;
  if (mode === 'write') return scope.file.write;
  if (mode === 'exec') return scope.file.exec;
  throw new Error(`unknown path mode: ${mode}`);
}

export function checkPath(entity, mode, targetPath, { cwd = process.cwd(), interactive = false } = {}) {
  const scope = resolveGate(entity, { interactive });
  if (scope.fatal) return { ok: false, scope, reason: scope.fatalReason ?? 'bond verification failed' };
  const absolutePath = resolveToolPath(targetPath, cwd);
  const prefixes = scopePathsForMode(scope, mode);
  if (!isUnder(absolutePath, prefixes)) {
    return { ok: false, scope, absolutePath, reason: `${mode} path outside granted scope: ${absolutePath}` };
  }
  if (isBlocked(absolutePath, scope.file.blocked)) {
    return { ok: false, scope, absolutePath, reason: `path blocked by bond policy: ${absolutePath}` };
  }
  if (isExtensionBlocked(absolutePath, scope.file.blocked_extensions)) {
    return { ok: false, scope, absolutePath, reason: `extension blocked by bond policy: ${fileExtension(absolutePath) || '(none)'}` };
  }
  if (mode === 'read' && !isExtensionAllowed(absolutePath, scope.file.read_extensions)) {
    return { ok: false, scope, absolutePath, reason: `extension not allowed for read: ${fileExtension(absolutePath) || '(none)'}` };
  }
  if (mode === 'write' && !isExtensionAllowed(absolutePath, scope.file.write_extensions)) {
    return { ok: false, scope, absolutePath, reason: `extension not allowed for write: ${fileExtension(absolutePath) || '(none)'}` };
  }
  return { ok: true, scope, absolutePath };
}

export function summarizeScope(scope) {
  return {
    mode: scope.mode,
    label: scope.label,
    bondCount: scope.bondCount,
    deviceId: scope.deviceId,
    fatal: !!scope.fatal,
    fatalReason: scope.fatalReason,
    errors: scope.errors,
    file: scope.file,
    tools: scope.tools,
    entity_capabilities: scope.entity_capabilities,
    devices: scope.devices,
    envLanes: scope.envLanes,
  };
}
