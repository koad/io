// /kingdom command — opens the interactive kingdom dashboard overlay.
// Shows flights, bonds, entity scope, health, and errors with DDP live updates.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DDPClient } from "../ddp";
import type { BondScope } from "../bond-gate/types";
import type { KingdomState } from "../identity/telemetry";
import { KingdomDashboard } from "./dashboard";

type Tab = "all" | "flights" | "bonds" | "scope" | "health" | "errors";

export function registerKingdomCommand(
  pi: ExtensionAPI,
  clients: { control: DDPClient; daemon: DDPClient },
  kingdom: KingdomState,
): void {
  // Capture the latest bond scope from the bond-gate
  let currentScope: BondScope | null = null;
  pi.events.on("koad-io:bond-scope", (scope: BondScope) => {
    currentScope = scope;
  });

  pi.registerCommand("kingdom", {
    description: "Show koad:io kingdom dashboard — flights, bonds, scope, health, entities, errors (DDP live)",
    handler: async (args, ctx) => {
      const tabArg = args?.trim().toLowerCase() ?? "";
      const tab: Tab =
        tabArg === "flights" ? "flights" :
        tabArg === "bonds"   ? "bonds"   :
        tabArg === "scope"   ? "scope"   :
        tabArg === "health"  ? "health"  :
        tabArg === "errors"  ? "errors"  :
        "all";

      const dashboard = new KingdomDashboard(
        clients,
        tab,
        kingdom,
        () => currentScope,
      );

      // Subscribe to both DDP backends for live updates
      let tuiRef: any;
      const onData = () => {
        dashboard.lastFetched = new Date();
        tuiRef?.requestRender();
      };
      clients.daemon.on("emission", onData);
      clients.daemon.on("bond", onData);
      clients.daemon.on("entity", onData);
      clients.control.on("flight", onData);
      clients.control.on("session", onData);

      // Also re-render when bond scope changes
      const onScope = () => tuiRef?.requestRender();
      pi.events.on("koad-io:bond-scope", onScope);

      await ctx.ui.custom((tui: any, theme: any, _kb: any, done: (v?: any) => void) => {
        tuiRef = tui;
        dashboard.onClose = () => done();
        return {
          render(width: number) {
            return dashboard.render(Math.min(width, 86), theme);
          },
          invalidate() {
            dashboard.invalidate();
          },
          handleInput(data: string) {
            if (dashboard.handleInput(data)) {
              tui.requestRender();
            }
          },
        };
      }, {
        overlay: true,
        overlayOptions: {
          anchor: "right-center",
          width: 86,
          maxHeight: "95%",
          margin: { top: 1, right: 1, bottom: 1, left: 1 },
        },
      });

      clients.daemon.off("emission", onData);
      clients.daemon.off("bond", onData);
      clients.daemon.off("entity", onData);
      clients.control.off("flight", onData);
      clients.control.off("session", onData);
      pi.events.off("koad-io:bond-scope", onScope);

      ctx.ui.notify("kingdom dashboard closed", "info");
    },
  });
}
