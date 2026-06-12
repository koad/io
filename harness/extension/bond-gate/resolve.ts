// koad:io bond-gate — bond resolution, scope merging, audit.

import type { ParsedBond, BondScope, FileScope, ToolGrants, EntityCapabilities, InteractiveOverride } from "./types";
import {
  HOME, DEFAULT_BLOCKED,
  EMPTY_FILE_SCOPE, EMPTY_TOOL_GRANTS, EMPTY_ENTITY_CAPS, EMPTY_INTERACTIVE,
  currentDeviceId,
  expandPath, parsePathList, parseNameList,
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

function envFlag(...names: string[]): boolean {
  return names.some(name => /^(1|true|yes|on)$/i.test(process.env[name] ?? ""));
}

function envNames(...names: string[]): string[] {
  const merged: string[] = [];
  for (const name of names) {
    for (const value of parseNameList(process.env[name])) {
      if (!merged.includes(value)) merged.push(value);
    }
  }
  return merged;
}

function pushUnique(target: string[], values: string[]): void {
  for (const value of values) {
    if (!target.includes(value)) target.push(value);
  }
}

function applyEnvLanes(scope: BondScope): BondScope {
  const envRead = parsePathList(process.env.KOAD_IO_HARNESS_READ_PATHS);
  const envWrite = parsePathList(process.env.KOAD_IO_HARNESS_WRITE_PATHS);
  const envExec = parsePathList(process.env.KOAD_IO_HARNESS_EXEC_PATHS);
  const envBlocked = envNames("KOAD_IO_HARNESS_BLOCKED_PATTERNS");

  const allowBash = envFlag("KOAD_IO_BOND_GATE_ALLOW_BASH", "KOAD_IO_PI_BOND_GATE_ALLOW_BASH");
  const allowDispatch = envFlag("KOAD_IO_BOND_GATE_ALLOW_DISPATCH", "KOAD_IO_PI_BOND_GATE_ALLOW_DISPATCH");
  const allowDispatchFollowup = envFlag("KOAD_IO_BOND_GATE_ALLOW_DISPATCH_FOLLOWUP", "KOAD_IO_PI_BOND_GATE_ALLOW_DISPATCH_FOLLOWUP");
  const allowDispatchComplete = envFlag("KOAD_IO_BOND_GATE_ALLOW_DISPATCH_COMPLETE", "KOAD_IO_PI_BOND_GATE_ALLOW_DISPATCH_COMPLETE");
  const envKoadioTools = envNames("KOAD_IO_BOND_GATE_ALLOW_KOADIO_TOOLS", "KOAD_IO_PI_BOND_GATE_ALLOW_KOADIO_TOOLS");
  const envKoadioCommands = envNames("KOAD_IO_BOND_GATE_ALLOW_KOADIO_COMMANDS", "KOAD_IO_PI_BOND_GATE_ALLOW_KOADIO_COMMANDS");
  const envChannelModerate = envNames("KOAD_IO_BOND_GATE_ALLOW_CHANNEL_MODERATE", "KOAD_IO_PI_BOND_GATE_ALLOW_CHANNEL_MODERATE");
  const envChannelParticipate = envNames("KOAD_IO_BOND_GATE_ALLOW_CHANNEL_PARTICIPATE", "KOAD_IO_PI_BOND_GATE_ALLOW_CHANNEL_PARTICIPATE");
  const envDispatchTargets = envNames("KOAD_IO_BOND_GATE_ALLOW_DISPATCH_TARGETS", "KOAD_IO_PI_BOND_GATE_ALLOW_DISPATCH_TARGETS");
  const envReadTools = envNames("KOAD_IO_BOND_GATE_ALLOW_READ_TOOLS", "KOAD_IO_PI_BOND_GATE_ALLOW_READ_TOOLS");
  const envWriteTools = envNames("KOAD_IO_BOND_GATE_ALLOW_WRITE_TOOLS", "KOAD_IO_PI_BOND_GATE_ALLOW_WRITE_TOOLS");

  const lanes: string[] = [];
  const next: BondScope = {
    ...scope,
    file: {
      read: [...scope.file.read],
      write: [...scope.file.write],
      exec: [...scope.file.exec],
      blocked: [...scope.file.blocked],
    },
    tools: {
      ...scope.tools,
      koadio_tools: [...scope.tools.koadio_tools],
      koadio_commands: [...scope.tools.koadio_commands],
      channels: {
        moderate: [...scope.tools.channels.moderate],
        participate: [...scope.tools.channels.participate],
      },
    },
    entity_capabilities: {
      ...scope.entity_capabilities,
      dispatch_targets: [...scope.entity_capabilities.dispatch_targets],
      message_targets: [...scope.entity_capabilities.message_targets],
      channel_roles: { ...scope.entity_capabilities.channel_roles },
    },
    envLanes: [...scope.envLanes],
    envReadTools: [...scope.envReadTools],
    envWriteTools: [...scope.envWriteTools],
  };

  if (envRead.length > 0) {
    pushUnique(next.file.read, envRead);
    lanes.push(`read+${envRead.length}`);
  }
  if (envWrite.length > 0) {
    pushUnique(next.file.write, envWrite);
    lanes.push(`write+${envWrite.length}`);
  }
  if (envExec.length > 0) {
    pushUnique(next.file.exec, envExec);
    lanes.push(`exec+${envExec.length}`);
  }
  if (envBlocked.length > 0) {
    pushUnique(next.file.blocked, envBlocked);
    lanes.push(`blocked+${envBlocked.length}`);
  }

  if (allowBash) {
    next.tools.bash = true;
    lanes.push("bash");
  }
  if (allowDispatch) {
    next.tools.dispatch = true;
    lanes.push("dispatch");
  }
  if (allowDispatchFollowup) {
    next.tools.dispatch_followup = true;
    lanes.push("dispatch-followup");
  }
  if (allowDispatchComplete) {
    next.tools.dispatch_complete = true;
    lanes.push("dispatch-complete");
  }
  if (envKoadioTools.length > 0) {
    pushUnique(next.tools.koadio_tools, envKoadioTools);
    lanes.push(`tools+${envKoadioTools.length}`);
  }
  if (envKoadioCommands.length > 0) {
    pushUnique(next.tools.koadio_commands, envKoadioCommands);
    lanes.push(`commands+${envKoadioCommands.length}`);
  }
  if (envChannelModerate.length > 0) {
    pushUnique(next.tools.channels.moderate, envChannelModerate);
    lanes.push(`channel-mod+${envChannelModerate.length}`);
  }
  if (envChannelParticipate.length > 0) {
    pushUnique(next.tools.channels.participate, envChannelParticipate);
    lanes.push(`channel-part+${envChannelParticipate.length}`);
  }
  if (envDispatchTargets.length > 0) {
    pushUnique(next.entity_capabilities.dispatch_targets, envDispatchTargets);
    lanes.push(`dispatch-targets+${envDispatchTargets.length}`);
  }
  if (envReadTools.length > 0) {
    pushUnique(next.envReadTools, envReadTools);
    lanes.push(`read-tools+${envReadTools.length}`);
  }
  if (envWriteTools.length > 0) {
    pushUnique(next.envWriteTools, envWriteTools);
    lanes.push(`write-tools+${envWriteTools.length}`);
  }

  if (lanes.length === 0) return scope;

  next.envLanes = [...scope.envLanes, ...lanes];
  next.label = `${scope.label} + env(${lanes.join(", ")})`;
  if (next.mode === "default") next.mode = "env-var";
  return next;
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
    if (intOverride.bash !== undefined) {
      tools.bash = intOverride.bash;
    }
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
    envLanes: [],
    envReadTools: [],
    envWriteTools: [],
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
      envLanes: [],
      envReadTools: [],
      envWriteTools: [],
    };
  }

  const { bonds, errors } = effectiveBonds(entity);
  log(`gate ${interactive ? "UI" : "headless"}: ${bonds.length} bonds, ${errors.length} errors, device=${deviceId}`);

  let scope: BondScope;
  if (bonds.length > 0) {
    scope = mergeBondScope(entity, bonds, errors, interactive);
  } else {
    const dispatchDir = process.env.HARNESS_WORK_DIR?.trim();
    if (dispatchDir) {
      const expanded = expandPath(dispatchDir);
      scope = {
        file: { read: [expanded], write: [expanded], exec: [expanded], blocked: [...DEFAULT_BLOCKED] },
        tools: { ...EMPTY_TOOL_GRANTS },
        entity_capabilities: { ...EMPTY_ENTITY_CAPS },
        interactive: {},
        errors,
        mode: "env-var",
        label: "mode=env-var dispatch dir r+w+e",
        bondCount: 0,
        deviceId,
        envLanes: [],
        envReadTools: [],
        envWriteTools: [],
      };
    } else if (errors.length > 0) {
      scope = {
        file: { ...EMPTY_FILE_SCOPE },
        tools: { ...EMPTY_TOOL_GRANTS },
        entity_capabilities: { ...EMPTY_ENTITY_CAPS },
        interactive: {},
        errors,
        mode: "default",
        label: "mode=default — no valid bonds",
        bondCount: 0,
        deviceId,
        envLanes: [],
        envReadTools: [],
        envWriteTools: [],
      };
    } else {
      scope = {
        file: { ...EMPTY_FILE_SCOPE },
        tools: { ...EMPTY_TOOL_GRANTS },
        entity_capabilities: { ...EMPTY_ENTITY_CAPS },
        interactive: {},
        errors: [],
        mode: "default",
        label: "mode=default — no bonds, no access",
        bondCount: 0,
        deviceId,
        envLanes: [],
        envReadTools: [],
        envWriteTools: [],
      };
    }
  }

  return applyEnvLanes(scope);
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
    if (scope.envLanes.length > 0) {
      lines.push(`  env lanes: ${scope.envLanes.join(", ")}`);
    }
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
