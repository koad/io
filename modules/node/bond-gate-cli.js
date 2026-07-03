#!/usr/bin/env node
import { checkCommand, checkPath, resolveGate, summarizeScope } from './bond-gate.js';

function usage() {
  console.error(`usage:
  node bond-gate-cli.js scope [--entity=<handle>] [--json]
  node bond-gate-cli.js command <name> [--entity=<handle>] [--alias=<grant>]... [--json]
  node bond-gate-cli.js path <read|write|exec> <path> [--entity=<handle>] [--cwd=<dir>] [--json]`);
}

const args = process.argv.slice(2);
const sub = args.shift();
const entity = (args.find(a => a.startsWith('--entity='))?.slice(9)) || process.env.ENTITY || 'koad';
const json = args.includes('--json');
const aliases = args.filter(a => a.startsWith('--alias=')).map(a => a.slice(8));
const cwd = args.find(a => a.startsWith('--cwd='))?.slice(6) || process.cwd();
const positional = args.filter(a => !a.startsWith('--'));

function emit(result, exitCode) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok === false) {
    console.error(result.reason);
  } else if (result.mode) {
    console.log(`${result.mode} · bonds=${result.bondCount} · commands=${result.tools.koadio_commands.join(',') || '(none)'}`);
  } else {
    console.log('ok');
  }
  process.exit(exitCode);
}

if (!sub) {
  usage();
  process.exit(64);
}

if (sub === 'scope') {
  emit(summarizeScope(resolveGate(entity)), 0);
}

if (sub === 'command') {
  const name = positional[0];
  if (!name) {
    usage();
    process.exit(64);
  }
  const result = checkCommand(entity, name, { aliases });
  emit(json ? { ...result, scope: summarizeScope(result.scope) } : result, result.ok ? 0 : 1);
}

if (sub === 'path') {
  const mode = positional[0];
  const targetPath = positional[1];
  if (!mode || !targetPath) {
    usage();
    process.exit(64);
  }
  const result = checkPath(entity, mode, targetPath, { cwd });
  emit(json ? { ...result, scope: summarizeScope(result.scope) } : result, result.ok ? 0 : 1);
}

usage();
process.exit(64);
