// /kingdom command — opens the interactive kingdom dashboard overlay.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DDPClient } from "../ddp";
import type { KingdomState } from "../identity/telemetry";
import { KingdomDashboard } from "./dashboard";

type Tab = "all" | "flights" | "bonds" | "health" | "errors";

export function registerKingdomCommand(pi: ExtensionAPI, ddp: DDPClient, kingdom: KingdomState): void {
  pi.registerCommand("kingdom", {
    description: "Show koad:io kingdom dashboard — flights, bonds, health (DDP live)",
    handler: async (args, ctx) => {
      const tabArg = args?.trim().toLowerCase() ?? "";
      const tab: Tab =
        tabArg === "flights" ? "flights" :
        tabArg === "bonds"   ? "bonds"   :
        tabArg === "health"  ? "health"  :
        tabArg === "errors"  ? "errors"  :
        "all";

      const dashboard = new KingdomDashboard(ddp, tab, kingdom);

      // Subscribe to DDP changes for live updates
      let tuiRef: any;
      const onData = () => {
        dashboard.lastFetched = new Date();
        tuiRef?.requestRender();
      };
      ddp.on("emission", onData);
      ddp.on("bond", onData);
      ddp.on("health", onData);

      await ctx.ui.custom((tui: any, theme: any, _kb: any, done: (v?: any) => void) => {
        tuiRef = tui;
        dashboard.onClose = () => done();
        return {
          render(width: number) {
            return dashboard.render(Math.min(width, 64), theme);
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
          width: 68,
          maxHeight: "90%",
          margin: { top: 1, right: 1, bottom: 1, left: 1 },
        },
      });

      ddp.off("emission", onData);
      ddp.off("bond", onData);
      ddp.off("health", onData);

      ctx.ui.notify("kingdom dashboard closed", "info");
    },
  });
}
