// koad:io bond-gate — bond resolution, scope merging, audit.

import type { ParsedBond, BondScope, FileScope, ToolGrants, EntityCapabilities, InteractiveOverride } from "./types";
import {
  HOME, DEFAULT_BLOCKED,
  EMPTY_FILE_SCOPE, EMPTY_TOOL_GRANTS, EMPTY_ENTITY_CAPS, EMPTY_INTERACTIVE,
  currentDeviceId,
  expandPath, parsePathList,
  log,
} from "./types";
import { parseBonds } from "./parse";

// ---------------------------------------------------------------------------
// Bond resolution
// ---------------------------------------------------------------------------

export function isExpired(bond: ParsedBond): boolean {
  if (!bond.expires) return false;
  const expiry = new Date(bond.expires);
  return !isNaN(expiry.getTime()) && expiry < new Date();
}

export function bondAppliesToDevice(bond: ParsedBond, deviceId = currentDeviceId()): boolean {
  return bond.device_ids.length === 0 || bond.device_ids.includes(deviceId);
}

export function effectiveBonds(entity: string): { bonds: ParsedBond[]; errors: string[] } {
  const { bonds: all, errors } = parseBonds(entity);
  const deviceId = currentDeviceId();

  const active = all.filter(b => {
    if (b.status !== "ACTIVE") return false;
    if (isExpired(b)) return false;
    if (b.to !== entity && b.to !== "*") return false;
    if (!bondAppliesToDevice(b, deviceId)) {
      log(`skip bond ${b.path}: device ${deviceId} not in [${b.device_ids.join(", ")}]`);
      return false;
    }
    return true;
  });

  return { bonds: active, errors };
}

export function mergeBondScope(entity: string, bonds: ParsedBond[], errors: string[], interactive: boolean): BondScope {
  const deviceId = currentDeviceId();
  const file: FileScope = {
    read: [],
    write: [],
    exec: [],
    blocked: [...DEFAULT_BLOCKED],
  };
  const tools: ToolGrants = { ...EMPTY_TOOL_GRANTS };
  const entity_caps: EntityCapabilities = { ...EMPTY_ENTITY_CAPS };
  const intOverride: InteractiveOverride = { ...EMPTY_INTERACTIVE };

  for (const b of bonds) {
    for (const p of b.capabilities.read)
      if (!file.read.includes(p)) file.read.push(p);
    for (const p of b.capabilities.write)
      if (!file.write.includes(p)) file.write.push(p);
    for (const p of b.capabilities.exec)
      if (!file.exec.includes(p)) file.exec.push(p);
    for (const p of b.capabilities.blocked)
      if (!file.blocked.includes(p)) file.blocked.push(p);

    if (b.tools.bash) tools.bash = true;
    if (b.tools.dispatch) tools.dispatch = true;
    if (b.tools.dispatch_followup) tools.dispatch_followup = true;
    if (b.tools.dispatch_complete) tools.dispatch_complete = true;
    for (const t of b.tools.koadio_tools)
      if (!tools.koadio_tools.includes(t)) tools.koadio_tools.push(t);
    for (const c of b.tools.koadio_commands)
      if (!tools.koadio_commands.includes(c)) tools.koadio_commands.push(c);
    for (const ch of b.tools.channels.moderate)
      if (!tools.channels.moderate.includes(ch)) tools.channels.moderate.push(ch);
    for (const ch of b.tools.channels.participate)
      if (!tools.channels.participate.includes(ch)) tools.channels.participate.push(ch);

    for (const t of b.entity_capabilities.dispatch_targets)
      if (!entity_caps.dispatch_targets.includes(t)) entity_caps.dispatch_targets.push(t);
    for (const t of b.entity_capabilities.message_targets)
      if (!entity_caps.message_targets.includes(t)) entity_caps.message_targets.push(t);
    for (const [ch, role] of Object.entries(b.entity_capabilities.channel_roles)) {
      if (!entity_caps.channel_roles[ch]) entity_caps.channel_roles[ch] = role;
    }

    if (b.interactive.exec) {
      for (const p of b.interactive.exec)
        if (!intOverride.exec?.includes(p)) (intOverride.exec ??= []).push(p);
    }
    if (b.interactive.write) {
      for (const p of b.interactive.write)
        if (!intOverride.write?.includes(p)) (intOverride.write ??= []).push(p);
    }
  }

  if (interactive) {
    if (intOverride.exec) {
      for (const p of intOverride.exec)
        if (!file.exec.includes(p)) file.exec.push(p);
    }
    if (intOverride.write) {
      for (const p of intOverride.write)
        if (!file.write.includes(p)) file.write.push(p);
    }
  }

  const dispatchDir = process.env.HARNESS_WORK_DIR;
  if (dispatchDir) {
    const expanded = expandPath(dispatchDir);
    if (!file.read.includes(expanded)) file.read.push(expanded);
    if (!file.write.includes(expanded)) file.write.push(expanded);
    if (!file.exec.includes(expanded)) file.exec.push(expanded);
    log(`  dispatch dir: ${expanded} (r+w+e)`);
  }

  log(`  scope: device=${deviceId} r${file.read.length} w${file.write.length} e${file.exec.length} b${file.blocked.length} bash=${tools.bash} dispatch=${tools.dispatch} →${entity_caps.dispatch_targets.join(",")}`);

  return {
    file,
    tools,
    entity_capabilities: entity_caps,
    interactive: intOverride,
    errors,
    mode: "bonded",
    label: `mode=bonded device=${deviceId} bonds=${bonds.length}`,
    bondCount: bonds.length,
    deviceId,
  };
}

export function resolveGate(entity: string, interactive: boolean): BondScope {
  const deviceId = currentDeviceId();
  const bypass = process.env.KOAD_IO_BOND_GATE_BYPASS === "1"
    || process.env.KOAD_IO_PI_BOND_GATE_BYPASS === "1";
  if (bypass) {
    return {
      file: { read: ["/"], write: ["/"], exec: ["/"], blocked: [] },
      tools: { bash: true, dispatch: true, dispatch_followup: true, dispatch_complete: true, koadio_tools: ["*"], koadio_commands: ["*"], channels: { moderate: ["*"], participate: ["*"] } },
      entity_capabilities: { dispatch_targets: ["*"], message_targets: ["*"], channel_roles: {} },
      interactive: {},
      errors: [],
      mode: "bypass",
      label: "mode=bypass — ALL ACCESS GRANTED",
      bondCount: 0,
      deviceId,
    };
  }

  const { bonds, errors } = effectiveBonds(entity);
  log(`gate ${interactive ? "UI" : "headless"}: ${bonds.length} bonds, ${errors.length} errors, device=${deviceId}`);
  if (bonds.length > 0) {
    return mergeBondScope(entity, bonds, errors, interactive);
  }

  const dispatchDir = process.env.HARNESS_WORK_DIR?.trim();
  if (dispatchDir) {
    const expanded = expandPath(dispatchDir);
    return {
      file: { read: [expanded], write: [expanded], exec: [expanded], blocked: [...DEFAULT_BLOCKED] },
      tools: { ...EMPTY_TOOL_GRANTS },
      entity_capabilities: { ...EMPTY_ENTITY_CAPS },
      interactive: {},
      errors,
      mode: "env-var",
      label: "mode=env-var dispatch dir r+w+e",
      bondCount: 0,
      deviceId,
    };
  }

  if (errors.length > 0) {
    return {
      file: { ...EMPTY_FILE_SCOPE },
      tools: { ...EMPTY_TOOL_GRANTS },
      entity_capabilities: { ...EMPTY_ENTITY_CAPS },
      interactive: {},
      errors,
      mode: "default",
      label: "mode=default — no valid bonds",
      bondCount: 0,
      deviceId,
    };
  }

  const envScope = parsePathList(process.env.KOAD_IO_HARNESS_READ_PATHS);
  const envWrite = parsePathList(process.env.KOAD_IO_HARNESS_WRITE_PATHS);
  const envExec = parsePathList(process.env.KOAD_IO_HARNESS_EXEC_PATHS);
  if (envScope.length > 0 || envWrite.length > 0 || envExec.length > 0) {
    return {
      file: { read: envScope, write: envWrite, exec: envExec, blocked: [...DEFAULT_BLOCKED] },
      tools: { ...EMPTY_TOOL_GRANTS },
      entity_capabilities: { ...EMPTY_ENTITY_CAPS },
      interactive: {},
      errors: [],
      mode: "env-var",
      label: "mode=env-var custom",
      bondCount: 0,
      deviceId,
    };
  }

  return {
    file: { ...EMPTY_FILE_SCOPE },
    tools: { ...EMPTY_TOOL_GRANTS },
    entity_capabilities: { ...EMPTY_ENTITY_CAPS },
    interactive: {},
    errors: [],
    mode: "default",
    label: "mode=default — no bonds, no access",
    bondCount: 0,
    deviceId,
  };
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export function bondBlockReason(entity: string, toolName: string, detail: string, scope?: BondScope): string {
  const now = new Date().toISOString();
  const lines = [
    `koad:io bond gate — blocked`,
    `  time:    ${now}`,
    `  entity:  ${entity}`,
    `  tool:    ${toolName}`,
    `  reason:  ${detail}`,
  ];
  if (scope) {
    const readDirs = scope.file.read.map(d => d.replace(HOME, "~")).join(", ");
    const writeDirs = scope.file.write.map(d => d.replace(HOME, "~")).join(", ");
    const execDirs = scope.file.exec.map(d => d.replace(HOME, "~")).join(", ");
    lines.push(`  device:  ${scope.deviceId}`);
    lines.push(`  file scope:`);
    lines.push(`    read:  ${readDirs || "(none)"}`);
    lines.push(`    write: ${writeDirs || "(none)"}`);
    lines.push(`    exec:  ${execDirs || "(none)"}`);
    lines.push(`  tool grants: bash=${scope.tools.bash} dispatch=${scope.tools.dispatch}`);
  }
  lines.push(`  action: use koad-io tool or ask_question(to="koad") to request expanded permissions`);
  return lines.join("\n");
}

export function auditBlock(entity: string, toolName: string, pathArg: string, reason: string): void {
  const _ip = process.env.KOAD_IO_BIND_IP ?? "10.10.10.10";
  const controlUrl = process.env.KOAD_IO_CONTROL_URL ?? `http://${_ip}:${process.env.KOAD_IO_CONTROL_PORT ?? "28283"}`;
  const emitEnabled = process.env.KOAD_IO_EMIT === "1";
  if (!emitEnabled) return;
  fetch(`${controlUrl}/emit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      entity,
      type: "tool.blocked",
      body: `${entity}: ${toolName} ${pathArg} blocked — ${reason}`,
      timestamp: new Date().toISOString(),
      meta: { payload: { tool: toolName, path: pathArg, reason, bondGate: true } },
    }),
    signal: AbortSignal.timeout(2000),
  }).catch(() => {});
}
