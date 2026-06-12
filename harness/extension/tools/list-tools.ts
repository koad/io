import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

type Scope = "active" | "all";
type ToolInfo = {
  name: string;
  description: string;
  source: string;
  path: string;
};

const ScopeParam = StringEnum(["active", "all"] as const, {
  description: 'Which tool set to inspect. "active" = currently usable tools. "all" = all registered tools.',
  default: "active",
});

function normalizeToolName(tool: any, i = 0): string {
  if (typeof tool === "string") return tool;
  return String(tool?.name ?? `(unnamed-${i})`);
}

function collectTools(pi: ExtensionAPI, scope: Scope): ToolInfo[] {
  const allTools = pi.getAllTools();
  const activeNames = new Set(pi.getActiveTools().map((tool: any, i: number) => normalizeToolName(tool, i)));
  const tools = scope === "all" ? allTools : allTools.filter((tool: any, i: number) => activeNames.has(normalizeToolName(tool, i)));
  return tools
    .map((tool: any, i: number) => {
      if (typeof tool === "string") {
        return {
          name: tool,
          description: "",
          source: "builtin/extension",
          path: "(metadata unavailable in this runtime)",
        } satisfies ToolInfo;
      }
      return {
        name: normalizeToolName(tool, i),
        description: String(tool?.description ?? ""),
        source: String(tool?.sourceInfo?.source ?? "unknown"),
        path: String(tool?.sourceInfo?.path ?? "(unknown)"),
      } satisfies ToolInfo;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function summarizeSources(tools: Array<{ source: string }>): string {
  const counts = new Map<string, number>();
  for (const tool of tools) counts.set(tool.source, (counts.get(tool.source) ?? 0) + 1);
  return [...counts.entries()].map(([source, count]) => `${source}:${count}`).join(" · ") || "none";
}

class ToolsOverlay {
  private scope: Scope;
  private tools: ToolInfo[];
  private selected = 0;

  constructor(
    private readonly pi: ExtensionAPI,
    private readonly tui: any,
    private readonly theme: any,
    initialScope: Scope,
    private readonly done: () => void,
  ) {
    this.scope = initialScope;
    this.tools = collectTools(pi, initialScope);
  }

  private box(lines: string[], width: number, title?: string): string[] {
    const innerW = Math.max(1, width - 2);
    const titleStr = title ? truncateToWidth(` ${title} `, innerW) : "";
    const titleW = visibleWidth(titleStr);
    const left = "─".repeat(Math.floor((innerW - titleW) / 2));
    const right = "─".repeat(Math.max(0, innerW - titleW - left.length));
    const border = (s: string) => this.theme.fg("border", s);
    return [
      border(`╭${left}`) + this.theme.fg("accent", titleStr) + border(`${right}╮`),
      ...lines.map(line => border("│") + truncateToWidth(line, innerW, "...", true) + border("│")),
      border(`╰${"─".repeat(innerW)}╯`),
    ];
  }

  private setScope(scope: Scope): void {
    if (scope === this.scope) return;
    this.scope = scope;
    this.tools = collectTools(this.pi, scope);
    this.selected = Math.max(0, Math.min(this.selected, this.tools.length - 1));
    this.tui.requestRender();
  }

  handleInput(data: string): void {
    if (
      data === "\x1b" || data === "\x03" || data === "\x04" ||
      matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c")) || matchesKey(data, Key.ctrl("d")) ||
      data === "q" || data === "Q"
    ) {
      this.done();
      return;
    }

    if (matchesKey(data, Key.left) || matchesKey(data, Key.shift("tab")) || data === "h") {
      this.setScope("active");
      return;
    }
    if (matchesKey(data, Key.right) || matchesKey(data, Key.tab) || data === "l") {
      this.setScope("all");
      return;
    }

    if (this.tools.length === 0) return;

    if ((matchesKey(data, Key.up) || data === "k") && this.selected > 0) {
      this.selected--;
      this.tui.requestRender();
      return;
    }
    if ((matchesKey(data, Key.down) || data === "j") && this.selected < this.tools.length - 1) {
      this.selected++;
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, Key.home)) {
      this.selected = 0;
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, Key.end)) {
      this.selected = this.tools.length - 1;
      this.tui.requestRender();
    }
  }

  invalidate(): void {}

  render(width: number): string[] {
    const t = {
      accent: (s: string) => this.theme.fg("accent", s),
      dim: (s: string) => this.theme.fg("dim", s),
      bold: (s: string) => this.theme.bold(s),
      success: (s: string) => this.theme.fg("success", s),
      warning: (s: string) => this.theme.fg("warning", s),
      muted: (s: string) => this.theme.fg("muted", s),
    };

    const lines: string[] = [];
    const tabs = [
      this.scope === "active" ? t.bold(`[ active ]`) : t.dim("  active  "),
      this.scope === "all" ? t.bold(`[ all ]`) : t.dim("  all  "),
    ].join(" ");

    lines.push(` ${tabs}`);
    lines.push(` ${t.success(`✓ ${this.scope} tools: ${this.tools.length}`)} ${t.dim(`· ${summarizeSources(this.tools)}`)}`);
    lines.push(` ${t.dim("←/→ switch scope · ↑/↓ move · Esc close")}`);
    lines.push(` ${t.dim("─".repeat(Math.max(8, width - 6)))}`);

    if (this.tools.length === 0) {
      lines.push(` ${t.warning("no tools found")}`);
      return this.box(lines, width, "tools");
    }

    const selectedTool = this.tools[this.selected]!;
    const visibleRows = 14;
    const start = Math.max(0, Math.min(this.selected - Math.floor(visibleRows / 2), this.tools.length - visibleRows));
    const shown = this.tools.slice(start, start + visibleRows);

    for (let i = 0; i < shown.length; i++) {
      const index = start + i;
      const tool = shown[i]!;
      const selected = index === this.selected;
      const prefix = selected ? t.accent("› ") : "  ";
      const name = selected ? t.accent(tool.name) : tool.name;
      lines.push(` ${prefix}${name} ${t.dim(`· ${tool.source}`)}`);
    }

    if (start + shown.length < this.tools.length) {
      lines.push(` ${t.dim(`… ${this.tools.length - (start + shown.length)} more`)}`);
    }

    lines.push(` ${t.dim("─".repeat(Math.max(8, width - 6)))}`);
    lines.push(` ${t.bold(selectedTool.name)} ${t.dim(`· ${selectedTool.source}`)}`);
    lines.push(` ${t.muted(selectedTool.path)}`);
    if (selectedTool.description) {
      lines.push(` ${selectedTool.description}`);
    } else {
      lines.push(` ${t.dim("(no description)")}`);
    }

    return this.box(lines, width, "tools");
  }
}

export function registerToolsInspect(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "list_tools",
    label: "List Tools",
    description: "List currently active tools or all registered tools, including whether each one is built-in or extension-provided.",
    promptSnippet: "Inspect available tools (scope: active|all)",
    promptGuidelines: [
      "Use when you need to verify whether a tool is actually available before planning around it.",
      "Prefer scope=active to see what the model can call right now.",
    ],
    parameters: Type.Object({
      scope: Type.Optional(ScopeParam),
    }),

    renderCall(args: any, theme: any) {
      const scope = args.scope ?? "active";
      return new Text(
        theme.fg("toolTitle", theme.bold("list_tools ")) + theme.fg("accent", scope),
        0,
        0,
      );
    },

    renderResult(result: any, { expanded }: any, theme: any) {
      const details = (result?.details ?? {}) as Record<string, any>;
      const tools = (details.tools ?? []) as ToolInfo[];
      const lines = [
        theme.fg("success", `✓ ${details.scope ?? "active"} tools: ${tools.length}`),
        `  ${theme.fg("dim", summarizeSources(tools))}`,
      ];
      const shown = expanded ? tools : tools.slice(0, 10);
      for (const tool of shown) {
        lines.push(`  ${theme.fg("accent", tool.name)} ${theme.fg("dim", `· ${tool.source}`)}`);
        if (expanded) lines.push(`    ${theme.fg("dim", tool.path)}`);
      }
      if (!expanded && tools.length > shown.length) {
        lines.push(`  ${theme.fg("dim", `… ${tools.length - shown.length} more`)}`);
      }
      return new Text(lines.join("\n"), 0, 0);
    },

    async execute(_toolCallId, params) {
      const scope = (params.scope ?? "active") as Scope;
      const tools = collectTools(pi, scope);
      const text = tools.map(t => `${t.name} (${t.source})`).join("\n") || "(none)";
      return {
        content: [{ type: "text", text }],
        details: { scope, tools },
      };
    },
  });

  pi.registerCommand("tools", {
    description: "Inspect active tools or all registered tools in an overlay panel",
    handler: async (args, ctx) => {
      const scope = args?.trim().toLowerCase() === "all" ? "all" : "active";
      await ctx.ui.custom<void>((tui: any, theme: any, _kb: any, done: () => void) => {
        const panel = new ToolsOverlay(pi, tui, theme, scope, done);
        return {
          render(width: number) {
            return panel.render(Math.min(width, 76));
          },
          invalidate() {
            panel.invalidate();
          },
          handleInput(data: string) {
            panel.handleInput(data);
          },
        };
      }, {
        overlay: true,
        overlayOptions: {
          anchor: "right-center",
          width: 80,
          maxHeight: "90%",
          margin: { top: 1, right: 1, bottom: 1, left: 1 },
        },
      });
    },
  });
}
