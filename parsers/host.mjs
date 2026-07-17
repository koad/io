import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveSummarySchema, SUMMARY_SCHEMA_ID } from "./_schema.mjs";
import {
  basenameOrInput,
  clip,
  collectTopLevelShape,
  fileTypeFromStat,
  formatBytes,
  formatDurationSeconds,
  formatMoney,
  formatNumber,
  looksBinaryBuffer,
  parseSimpleFrontmatter,
  readHeadBuffer,
  sampleTextLines,
} from "./_utils.mjs";

const PARSERS_DIR = path.dirname(new URL(import.meta.url).pathname);

function printHelp() {
  console.log(`koad:io summary

Usage:
  summary <target>
  summary <parser> <target>
  summary --parser <name> <target>

Options:
  --parser <name>       explicit parser (session, flight, jsonl, json, markdown-frontmatter, directory, message)
  --format <fmt>        text (default), json, schema
  --schema <id>         schema id for json output (default: ${SUMMARY_SCHEMA_ID})
  --verbosity <level>   quiet|normal|high|full or 0..3
  --list-parsers        list installed parser modules
  --help                show this help

Notes:
  - positional parser shorthand stays compatible with callers like: summary session <file>
  - no parser? summary autodetects
  - unknown-ish files get structural summaries, not invented prose
`);
}

function parseArgValue(argv, index) {
  const next = argv[index + 1];
  if (!next) throw new Error(`Missing value for ${argv[index]}`);
  return next;
}

function normalizeVerbosity(value) {
  if (value == null) return 1;
  const raw = String(value).trim().toLowerCase();
  if (["0", "quiet", "low"].includes(raw)) return 0;
  if (["1", "normal", "default", "medium"].includes(raw)) return 1;
  if (["2", "high", "verbose"].includes(raw)) return 2;
  if (["3", "full", "max"].includes(raw)) return 3;
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return Math.max(0, Math.min(3, Math.round(numeric)));
  return 1;
}

export function parseCliArgs(argv) {
  const args = [...argv];
  const options = {
    parserName: null,
    format: "text",
    schema: SUMMARY_SCHEMA_ID,
    verbosity: 1,
    listParsers: false,
    help: false,
    target: null,
    positionalParser: null,
  };
  const positional = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--list-parsers") {
      options.listParsers = true;
      continue;
    }
    if (arg === "--parser") {
      options.parserName = parseArgValue(args, index);
      index += 1;
      continue;
    }
    if (arg.startsWith("--parser=")) {
      options.parserName = arg.split("=").slice(1).join("=");
      continue;
    }
    if (arg === "--format") {
      options.format = parseArgValue(args, index);
      index += 1;
      continue;
    }
    if (arg.startsWith("--format=")) {
      options.format = arg.split("=").slice(1).join("=");
      continue;
    }
    if (arg === "--schema") {
      options.schema = parseArgValue(args, index);
      index += 1;
      continue;
    }
    if (arg.startsWith("--schema=")) {
      options.schema = arg.split("=").slice(1).join("=");
      continue;
    }
    if (arg === "--verbosity") {
      options.verbosity = normalizeVerbosity(parseArgValue(args, index));
      index += 1;
      continue;
    }
    if (arg.startsWith("--verbosity=")) {
      options.verbosity = normalizeVerbosity(arg.split("=").slice(1).join("="));
      continue;
    }
    positional.push(arg);
  }

  if (!options.parserName && positional.length >= 2) {
    options.positionalParser = positional[0];
    options.target = positional.slice(1).join(" ");
  } else if (positional.length >= 1) {
    options.target = positional.join(" ");
  }

  return options;
}

export async function loadParsers() {
  const entries = fs.readdirSync(PARSERS_DIR)
    .filter((entry) => entry.endsWith(".mjs"))
    .filter((entry) => !entry.startsWith("_") && entry !== "host.mjs")
    .sort();
  const parsers = [];
  for (const entry of entries) {
    const mod = await import(pathToFileURL(path.join(PARSERS_DIR, entry)).href);
    if (mod?.parser?.name) parsers.push(mod.parser);
  }
  return parsers;
}

function findParser(parsers, name) {
  const raw = String(name || "").trim().toLowerCase();
  if (!raw) return null;
  return parsers.find((parser) => parser.name === raw || (parser.aliases || []).map((alias) => alias.toLowerCase()).includes(raw)) || null;
}

function resolveTarget(input) {
  if (!input) return { input: null, resolved: null, exists: false, type: "missing", size_bytes: null };
  const expanded = input.startsWith("~/") ? path.join(process.env.HOME || "", input.slice(2)) : input;
  const resolved = path.resolve(expanded);
  if (!fs.existsSync(resolved)) {
    return { input, resolved, exists: false, type: "missing", size_bytes: null };
  }
  const stat = fs.statSync(resolved);
  return {
    input,
    resolved,
    exists: true,
    type: fileTypeFromStat(stat),
    size_bytes: stat.size ?? null,
  };
}

function buildContext(options) {
  const target = resolveTarget(options.target);
  return {
    ...options,
    target,
    async readText(maxBytes = 8192) {
      if (!target.exists || target.type !== "file") return "";
      const buffer = readHeadBuffer(target.resolved, maxBytes);
      return looksBinaryBuffer(buffer) ? "" : buffer.toString("utf8");
    },
    async readFirstLine() {
      const text = await this.readText(4096);
      return text.split(/\r?\n/).find((line) => line.trim()) || "";
    },
  };
}

function summarizeFallback(ctx) {
  if (ctx.target.exists && ctx.target.type === "directory") {
    const entries = fs.readdirSync(ctx.target.resolved, { withFileTypes: true });
    return {
      summary: {
        title: `Structural summary :: ${basenameOrInput(ctx.target.resolved)}`,
        headline: `${entries.length} entries; no directory parser matched explicitly, using structural view.`,
        metrics: { entries: entries.length },
        sections: [
          {
            title: "entries",
            items: entries.slice(0, ctx.verbosity >= 2 ? 24 : 12).map((entry) => `- ${entry.isDirectory() ? "[d]" : entry.isFile() ? "[f]" : "[?]"} ${entry.name}`),
          },
        ],
      },
      data: { kind: "directory", entries: entries.map((entry) => entry.name) },
      warnings: ["No explicit directory parser matched; using generic structural summary."],
    };
  }

  if (ctx.target.exists && ctx.target.type === "file") {
    const head = readHeadBuffer(ctx.target.resolved, 8192);
    const binary = looksBinaryBuffer(head);
    const sampleLines = binary ? [] : sampleTextLines(ctx.target.resolved, { maxLines: ctx.verbosity >= 2 ? 12 : 6, maxBytes: 8192 });
    const parsedFrontmatter = binary ? { hasFrontmatter: false, attributes: {}, body: "" } : parseSimpleFrontmatter(head.toString("utf8"));
    return {
      summary: {
        title: `Structural summary :: ${path.basename(ctx.target.resolved)}`,
        headline: binary
          ? `Binary-ish file; reporting structure only (${formatBytes(ctx.target.size_bytes || 0)}).`
          : `${formatBytes(ctx.target.size_bytes || 0)} text file; structural summary only.`,
        metrics: {
          bytes: ctx.target.size_bytes,
          extension: path.extname(ctx.target.resolved) || "<none>",
          binary,
          frontmatter_keys: Object.keys(parsedFrontmatter.attributes || {}).length,
        },
        sections: [
          {
            title: "frontmatter",
            items: Object.entries(parsedFrontmatter.attributes || {}).slice(0, 12).map(([key, value]) => `- ${key}: ${value}`),
          },
          {
            title: "sample lines",
            items: sampleLines.map((line) => `- ${clip(line, 180)}`),
          },
        ].filter((section) => section.items.length > 0),
      },
      data: {
        kind: binary ? "binary-file" : "text-file",
        sample_lines: sampleLines,
      },
      warnings: ["No parser matched; this is a structural summary, not generated prose."],
    };
  }

  return {
    summary: {
      title: `Structural summary :: ${basenameOrInput(ctx.target.input)}`,
      headline: "Target does not resolve to an existing path. Nothing to summarize structurally beyond the input string.",
      metrics: {},
      sections: [],
    },
    data: { kind: "missing", input: ctx.target.input },
    warnings: ["Target path does not exist and no parser-specific resolver matched it."],
  };
}

export async function detectParser(parsers, ctx) {
  let best = null;
  for (const parser of parsers) {
    const score = Number(await parser.canParse(ctx)) || 0;
    if (!best || score > best.score) best = { parser, score };
  }
  return best && best.score > 0 ? best : null;
}

function normalizeResult(result, meta) {
  return {
    schema: meta.schema,
    generated_at: new Date().toISOString(),
    parser: meta.parser,
    autodetected: meta.autodetected,
    target: result.target || meta.target,
    verbosity: meta.verbosity,
    summary: {
      title: result.summary?.title || "Summary",
      headline: result.summary?.headline || "",
      metrics: result.summary?.metrics || {},
      sections: result.summary?.sections || [],
      compat_footer: result.summary?.compat_footer || {},
    },
    data: result.data || {},
    warnings: result.warnings || [],
  };
}

export function renderText(result) {
  const lines = [];
  lines.push(result.summary.title);
  lines.push(`Parser: ${result.parser}${result.autodetected ? " (autodetected)" : " (explicit)"}`);
  if (result.target?.resolved) lines.push(`Target: ${result.target.resolved}`);
  if (result.summary.headline) {
    lines.push("");
    lines.push(result.summary.headline);
  }
  const metricsEntries = Object.entries(result.summary.metrics || {}).filter(([, value]) => value != null && value !== "");
  if (metricsEntries.length) {
    lines.push("");
    lines.push("Metrics:");
    for (const [key, value] of metricsEntries) {
      lines.push(`- ${key}: ${value}`);
    }
  }
  for (const section of result.summary.sections || []) {
    if (!section.items?.length) continue;
    lines.push("");
    lines.push(`── ${section.title} ──`);
    for (const item of section.items) lines.push(item);
  }
  if (result.warnings?.length) {
    lines.push("");
    lines.push("Warnings:");
    for (const warning of result.warnings) lines.push(`- ${warning}`);
  }
  const footer = result.summary.compat_footer || {};
  const footerEntries = Object.entries(footer).filter(([, value]) => value != null && value !== "");
  if (footerEntries.length) {
    lines.push("");
    for (const [key, value] of footerEntries) lines.push(`${key}: ${value}`);
  }
  return `${lines.join("\n")}\n`;
}

export async function runSummary(options) {
  const parsers = await loadParsers();
  const explicit = options.parserName || options.positionalParser;
  const ctx = buildContext(options);

  let chosen = null;
  let autodetected = false;

  if (explicit) {
    chosen = findParser(parsers, explicit);
    if (!chosen) throw new Error(`Unknown parser: ${explicit}`);
  } else {
    const detected = await detectParser(parsers, ctx);
    if (detected) {
      chosen = detected.parser;
      autodetected = true;
    }
  }

  const rawResult = chosen ? await chosen.summarize(ctx) : summarizeFallback(ctx);
  return normalizeResult(rawResult, {
    schema: options.schema || SUMMARY_SCHEMA_ID,
    parser: chosen?.name || "structural",
    autodetected: chosen ? autodetected : true,
    target: ctx.target,
    verbosity: options.verbosity,
  });
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const parsers = await loadParsers();
  if (options.listParsers) {
    for (const parser of parsers) {
      console.log(`${parser.name}${parser.aliases?.length ? ` (${parser.aliases.join(", ")})` : ""} — ${parser.description || ""}`);
    }
    return;
  }
  if (options.format === "schema") {
    console.log(JSON.stringify(resolveSummarySchema(options.schema), null, 2));
    return;
  }
  if (!options.target) {
    printHelp();
    process.exitCode = 1;
    return;
  }
  const result = await runSummary(options);
  if (options.format === "json") {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(renderText(result).trimEnd());
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`summary: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
