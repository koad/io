# PRIMER: profiles/

## What is this directory?

Isolated application data directories (datadirs) for third-party applications. It provides sandboxed profile environments so apps — especially browsers — can run in entity-specific contexts without sharing state with each other or with the operator's personal browser.

## What does it contain?

- `browser/` — Browser profile subdirectories
  - `google-chrome/` — Google Chrome datadir(s), organized by app ID for sandboxed browser instances

## Who works here?

The `commands/browse` command reads from this directory when launching sandboxed browser sessions. Entities that automate web browsing (scraping, auth flows, passenger tasks) use profiles stored here to maintain isolated persistent state.

## What to know before touching anything?

Browser profiles accumulate state (cookies, local storage, cached credentials). Deleting a profile directory is destructive — the session state cannot be recovered. Do not commit these directories to git (they contain sensitive runtime data and are large). If an entity's browser automation breaks, check whether the relevant profile directory exists and is intact before debugging the script. Adding a new app ID subdirectory under `browser/google-chrome/` is the correct way to create a new isolated session; consult `commands/browse` docs for the naming convention.
