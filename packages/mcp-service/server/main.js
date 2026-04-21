// main.js — MCP Service entry point
// VESTA-SPEC-139: Kingdom Tool Substrate for AI Harnesses
//
// This file runs last in the load order (see package.js addFiles sequence).
// All sub-modules (auth, session, tool-loader, daemon-tools, transport) have
// already run and populated their globalThis.* exports before this file runs.
//
// This file:
//   1. Mounts the HTTP+SSE transport on /mcp
//   2. Registers notification hooks into the daemon's systems

Meteor.startup(() => {
  // Mount the HTTP+SSE transport on /mcp
  if (globalThis.McpServiceTransport && globalThis.McpServiceTransport.mountMcpTransport) {
    globalThis.McpServiceTransport.mountMcpTransport();
  } else {
    console.error('[mcp-service] McpServiceTransport not available — mount failed');
    return;
  }

  // ---------------------------------------------------------------------------
  // Notification hooks — VESTA-SPEC-139 §7.4
  //
  // Hook into daemon's emission trigger system, flight methods, and message
  // writer to fan out MCP notifications to active sessions.
  // ---------------------------------------------------------------------------

  // 1. Emission notifications
  //    Wrap evaluateEmissionTriggers so every emission write fans out to MCP sessions.
  const origEval = globalThis.evaluateEmissionTriggers;
  globalThis.evaluateEmissionTriggers = function(emission, event) {
    if (origEval) origEval(emission, event);
    const McpSession = globalThis.McpServiceSession;
    if (McpSession) {
      try { McpSession.notifyEmission(emission, event); } catch (e) {}
    }
  };
  console.log('[mcp-service] patched evaluateEmissionTriggers for notification fanout');

  // 2. Message notifications
  //    Expose a hook point for api.js's writeMessageToDisk to call after writing.
  //    api.js calls globalThis.mcpNotifyMessage(entity, filename) if it exists.
  globalThis.mcpNotifyMessage = function(entity, filename) {
    const McpSession = globalThis.McpServiceSession;
    if (McpSession) {
      try { McpSession.notifyMessage(entity, filename); } catch (e) {}
    }
  };
  console.log('[mcp-service] globalThis.mcpNotifyMessage registered');

  // 3. Flight notifications
  //    Wrap Meteor methods flight.open / flight.close.
  //    Method handlers are defined in flights.js (runs before this via daemon load order).
  const methodHandlers = Meteor.server && Meteor.server.method_handlers;
  if (methodHandlers) {
    const origFlightOpen = methodHandlers['flight.open'];
    if (origFlightOpen) {
      methodHandlers['flight.open'] = function(doc) {
        const result = origFlightOpen.call(this, doc);
        const McpSession = globalThis.McpServiceSession;
        if (McpSession) {
          try {
            McpSession.notifyFlight({ _id: doc._id, entity: doc.entity, briefSlug: doc.briefSlug || '' }, 'open');
          } catch (e) {}
        }
        return result;
      };
    }

    const origFlightClose = methodHandlers['flight.close'];
    if (origFlightClose) {
      methodHandlers['flight.close'] = function(flightId, update) {
        const result = origFlightClose.call(this, flightId, update);
        const Flights = globalThis.FlightsCollection;
        const McpSession = globalThis.McpServiceSession;
        if (Flights && McpSession) {
          try {
            const flight = Flights.findOne({ _id: flightId });
            if (flight) McpSession.notifyFlight(flight, 'close');
          } catch (e) {}
        }
        return result;
      };
    }

    if (origFlightOpen || origFlightClose) {
      console.log('[mcp-service] patched flight.open/close for notification fanout');
    }
  }

  console.log('[mcp-service] startup complete — MCP service live at /mcp');
});
