# PRIMER: passenger/

## What is this directory?

The dark-passenger Chrome extension. It connects the browser to the local koad:io daemon via Meteor DDP, allowing entities to observe, react, and act as the operator browses the web. Local-first, no cloud, no leaks.

## What does it contain?

- `src/` — Extension source (client-side JavaScript, background scripts, content scripts)
- `commands/` — Entity commands available from within the extension context
- `features/` — Feature spec documents for planned/in-progress extension capabilities
- `config/` — Extension runtime configuration
- `theme/` — Visual theme definitions for the extension UI
- `README.md` — Full feature overview, setup instructions, and use cases
- `DEVELOPERS.md` — Developer reference

## Who works here?

Vulcan builds and maintains the extension. It communicates with `~/.koad-io/daemon/` as the server counterpart. Livy documents the user-facing setup and use cases.

## What to know before touching anything?

Load the extension in Chrome via Developer Mode ("Load unpacked" pointing at this directory). It auto-connects to `$KOAD_IO_BIND_IP:9568` — the daemon must be running first (`koad-io setup daemon`). This is a Chrome extension, not a Node package or Meteor app — standard browser extension development rules apply. Changes to the DDP protocol must be coordinated with the daemon. The extension carries its own `passenger.json` that maps to the entity PWA config model.
