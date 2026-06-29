# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Summary of 656 commits since 3.6.9 (2026-03-17 → 2026-05-29), grouped by Keep a Changelog category and then by era. Includes current in-tree changes._

### Added

#### 2026-05-30 - Current working tree
- Bond and key discovery HTTP endpoints in `packages/core` for `/api/bonds`, `/api/bonds/has`, `/api/keys`, and per-entity avatar serving via `/<handle>.png`.
- `HARNESS_WORK_DIR` propagation in the Pi harness so dispatched sessions can resolve scope against the active workspace.

#### 2026-05 - Sovereign identity, daemon APIs, and operator surfaces
- `koad-io init sovereign`, unified `init`, mnemonic recovery, multi-device ceremony flow, sigchain filing, and automatic post-ceremony repo commit/push.
- `identity init`, `identity submit`, `identity verify`, and `identity device-key add`, plus `@koad-io/node` ceremony, sigchain, auth, CID, and mnemonic modules.
- PGP visitor authentication, portal entity login, fingerprint→entity lookup, session-token storage, and visitor-access bond scaffolding.
- Pluggable daemon indexers, indexer admin UI, and graduated indexer suites for briefs, primers, emissions, bonds, passengers, sessions, JSON folders, workspace-entity state, and goals/projects/repos.
- Daemon/framework endpoints for questions, emissions summaries, identity heads, sovereign profiles, corpus-by-URL lookup, context injection, scripts, auth tokens, live prompt typing, channels, and drive-chain operations.
- Keys API coverage for chain discovery, xpub derivation, address derivation, address validation, mnemonic inspection, and PSBT create/sign/finalize/inspect flows.
- Browser-extension and desktop work including side panel/popup HUD surfaces, MCP token flow, daemon proxying, active-tab tracking, sovereign profile caching, offline outbound queueing, per-workspace entity selection, and entityless window support.
- New or extracted package work around daemon indexers, declarations, emission types, session history, scoring, drive-chain, and harness bridging.

#### 2026-04 - Harness substrate, profiles, and framework commands
- `koad-io harness` routing plus Claude, Codex, Pi, OpenCode, Gemini, Ollama, bash, and zsh harness implementations with provider/model routing, `--continue`, stdin piping, and dispatch modes.
- Harness startup/context assembly using `KOAD_IO.md`, `PRIMER.md`, role primers, git status, briefs, active flights, bookmarked questions, and dynamic variable/date substitution.
- Native framework operations including `think`, `sign`, `io`, `stop`, `restart`, `roles`, `kingdom init`, entity memory commands, profile command families, and CID generation.
- Reactive Blaze application layout work, IPFS client and sovereign-profile substrate, profile signing/auth flows, and stronger desktop integration.
- Framework docs and structure additions including philosophy, AGENTS/PRIMER-era scaffolding, hooks guidance, and package-level orientation files.

#### 2026-03 - Post-3.6.9 foundations
- Desktop application scaffolding, shell commands, worker-process package, event logging package, commit command support, and early post-release package metadata cleanup.

### Changed

#### 2026-05-30 - Current working tree
- Pi runtime extension path moved from `harness/extensions/koad-io` to `harness/extension`.
- Pi settings switched to `openai-codex` / `gpt-5.4`, with steering and follow-up modes enabled and prompt loading pointed at harness skills.
- Bond-gate now grants `koad-io` tools and subcommands explicitly through `koadio_tools` and `koadio_commands` instead of treating them as implicitly allowed.
- Dispatch workspace fallback now grants read/write/exec scope for the active worktree.

#### 2026-05 - Consolidation and runtime layout
- Framework structure consolidated around the newer daemon/harness split, with config moved under `harness/`, legacy boundaries collapsed, and project layout simplified.
- Runtime/content locations shifted toward `~/.koad/` and `~/.forge/`, including kingdom config, desktop/passenger assets, onboarding, documentation, and training material.
- Bond resolution hardened into a default-deny model with capability merging, env fallback modes, frontmatter capability parsing, and dispatch-directory awareness.
- Search and corpus discovery expanded to include documentation paths, additional DB modes such as `juno_drift`, and broader markdown/atlas indexing.
- `KOAD_IO.md` refocused into a lighter concepts-first lighthouse.

#### 2026-04 - Harness behavior and developer workflow
- Skeleton guidance shifted from AGENTS-era defaults toward CLAUDE/PRIMER-oriented scaffolding and directory-as-brief workflow.
- Harness/context behavior evolved to include root/roaming policies, DDP gating, role primers, startup context assembly, tickler injection, and richer statusline surfaces.
- Start/build/deploy flow tightened around foreground local runs, screen/log handling, bundle permissions, and environment propagation.

#### 2026-03 - Licensing and package framing
- Licensing moved from older GPLv2-era framing toward GPLv3 and later four-tier policy documentation.

### Removed

#### 2026-05 - Legacy subsystem cleanup
- Legacy packages and skeleton scaffolding superseded by the consolidated daemon/harness architecture.
- Old memory command and entity emit subsystem, obsolete kingdom configuration, stale question index, dead opencode plugin/patch layers, and compatibility shims.
- Earlier trust/primitives layers that no longer fit the new ceremony path, including the old sovereign bond subsystem plus triggers/worker documentation primitives.

#### 2026-04 to 2026-03 - Earlier post-release cleanup
- Automatic package cloning from pre-install, obsolete hooks, template files from the bare skeleton, unused theme-engine/bundle artifacts, and other outdated package/UI leftovers.

### Fixed

#### 2026-05-30 - Current working tree
- Commissioning prompt formatting and ready-search guidance for entity-scoped checks.

#### 2026-05 - Auth, indexing, and runtime reliability
- Portal auth and token issuance regressions, including `_insertLoginToken` usage, parsed-body handling in `/api/auth/token`, lazy token-store initialization, and stream fallback parsing.
- Daemon/indexer issues around duplicate brief IDs, YAML continuation parsing, deferred backfills, Claude session attribution, watcher startup, and missing package registrations.
- Identity/init edge cases including BIP39 passphrase handling, quoted `.env` writes, re-ask loops on rerun, recovery-path genesis filing, and symmetric remote handling.
- Worker/runtime stability by removing the global uncaught-exception/unhandled-rejection cascade and gating worker registration behind configuration.

#### 2026-04 - Harness and launcher correctness
- Harness/launcher issues around stderr diagnostics, `EXEC_FILE` leakage, env cascading, flag/value preservation, local-start behavior, and `ROOT_URL` handling.
- Gestate, opencode, and dispatcher correctness issues affecting prompt flow, home-machine defaults, and command/value parsing.

### Security

#### 2026-05-30 - Current working tree
- Bond-gate restrictions tightened so `koad-io` tool access is capability-granted rather than implicitly open.

#### 2026-05 to 2026-04 - Identity and trust boundaries
- Per-entity `GNUPGHOME` isolation, stricter entity-handle validation, redaction of sensitive env values from publications, sign-required auth helpers, and TTL-backed session/token handling.
- Visitor write, signed-interaction, and bonded tool-execution boundaries tightened across harness and daemon flows.

### Documentation

#### 2026-05-30 - Current working tree
- Commissioning prompt report table aligned and ready-search instructions clarified to use `--entity <name>`.

#### 2026-05 - Atlas, primers, and lighthouse cleanup
- Broad `PRIMER.md`/README coverage across commands, harness, helpers, hooks, modules, packages, plugins, skeletons, training, and browser-extension surfaces.
- Training and cascade docs expanded for indexers, sovereign services, harness environment flow, and framework orientation.
- `KOAD_IO.md` slimmed and generalized to focus on concepts rather than kingdom-specific operational detail.

#### 2026-04 to 2026-03 - Framework orientation
- README, hooks docs, package docs, philosophy, and skeleton guidance expanded to support the newer harness-first workflow.

## [3.6.9] - 2026-03-17

### Major Changes
- **Meteor 3.0 Migration**: Complete migration of all packages to Meteor 3.0
- **Package Architecture Refactor**: Converted submodules to self-contained Meteor packages
- **Monorepo Restructure**: Removed submodules in favor of integrated package structure

### Added - Core Packages
- **koad:io-accounts**: Token-based authentication system with secure session management
- **koad:io-router**: Unified client/server routing with route progress bar
- **koad:io-session**: Persistent client-side storage system
- **koad:io-templating**: Templating support for Meteor applications
- **koad:io-search**: Real-time local and server search UI with unified content discovery
- **koad:io-core**: Enhanced core functionality with reactive dependencies
- **koad:io-theme-engine**: Theme system with proper Meteor 3.0 metadata
- **koad:io-head-js**: Head.js integration for Meteor applications
- **koad:io-template-helpers**: Migrated from submodule to self-contained package

### Added - Infrastructure
- **Daemon System**: Core daemon features for koad:io ecosystem with auto-start capabilities
- **Upstart Hook**: Auto-start daemon and desktop on boot
- **Database Indexes**: Optimized query performance across collections
- **Automated Cleanup**: Database maintenance tasks with TTL auto-cleanup
- **Search History Indexes**: With automatic TTL-based cleanup

### Added - Features
- **Decentralized Identity**: IPFS storage support and cryptographic identity system
- **Server Cryptographic Identity**: kbpgp-based identity implementation
- **Global Search System**: Unified content discovery across application
- **Counters Collection**: Helper methods and documentation for counter management
- **ApplicationSupporters Collection**: With timestamp hooks
- **Input Sanitization**: Server-side module for security
- **Instance Discovery**: Enhanced with better error handling and logging
- **Cron Module**: Helper API with comprehensive documentation
- **Connection Tracking**: Session lifecycle docs and restart handling

### Added - Browser Extension
- **Dark Passenger**: Chrome extension feature specifications
- **Project Directory Tracking**: Allow passenger to track project directories
- **Developer Documentation**: Added DEVELOPERS.md for browser extension

### Added - CLI & Tools
- **Init Command**: Initialization command for existing entities
- **Assert Datadir Command**: Ensure data directory exists
- **OpenCode Integration**: Custom binary support with fallback mechanisms
- **Node-tools CLI Helper**: Command-line utilities
- **Enhanced Gestate Command**: Added --full option for complete setup
- **Starship Prompt**: Install script for koad:io-compatible prompt

### Improved
- **Shell Portability**: POSIX-compliant lowercase conversion for better compatibility
- **Shell Fallback**: Improved handling when opencode is unavailable
- **Skeleton Install UX**: Colored output and simplified package paths
- **Connection Methods**: Better documentation and error handling
- **Package Metadata**: Proper metadata across all packages
- **Package Naming**: Simplified by removing redundant prefixes (koad-io-)
- **Package Versions**: Aligned across monorepo (3.6.9)

### Fixed
- **Theme Variables**: Fixed calculation issues
- **Typo**: Fixed extention->extension in multiple files
- **Dispatcher Typo**: Corrected in test files
- **Hook Command Names**: Fixed bad command references
- **Indentation**: Fixed ApplicationEvents and ApplicationErrors exports
- **RSA Key Discovery**: Disabled due to build issues in some environments

### Changed
- **Package Structure**: Removed session package, replaced with koad:io-session
- **Router System**: Removed deprecated router submodules
- **Docs**: Removed docs submodule from monorepo
- **Directory Naming**: Simplified (koad-io-core to core)
- **Head.js Reference**: Updated to use GitHub repository URL
- **Search History**: Removed automatic subscription on login

### Security
- **Sensitive Files**: Removed .env from repo, added .env.example template
- **Device Keys**: Removed passwords from device keys
- **Gitignore Updates**: Enhanced patterns across daemon, hooks, and passenger directories

### Documentation
- **Enhanced Docs**: Added Meteor packages, MongoDB modes, and skeleton documentation
- **Hook Documentation**: Improved with opencode integration examples
- **Gestate Command**: Added comprehensive README
- **Spawn Command**: Added usage explainer
- **Passenger README**: Added documentation for passenger directory
- **Interface Skeleton**: Added README

### Removed
- **Dead Code**: Cleaned up unused client globals and cleanup-tasks.js
- **Deprecated Code**: Removed unnecessary non-runnable code
- **Restrictive Gitignore**: Removed to allow more packages in packages/
- **Unused Dependencies**: Cleaned up legacy submodule references

## [0.1.1] - 2022-05-17

### Added
- Sci-fi themed elements to CLI output
- Hook improvements for entity management
- Link to entity documentation within the book

### Fixed
- Parsing order bug in command processing
- Spelling and grammar improvements in README

### Documentation
- Cleaned up README with additional hooks documentation
- Small tweaks to improve clarity

## [0.1.0] - 2022-04-19

### Added
- Non-argument command hook to reload bash with new entity
- Comments to /bin/koad-io for better code documentation
- Matrix chat badge to README
- Local asset for badge display

### Changed
- Reordered non-argument command to run before koad-io script output

### Documentation
- Multiple README improvements and clarifications

## [0.0.1] - 2021-09-30

### Added
- Initial commit and project foundation

[Unreleased]: https://github.com/koad/koad-io/compare/3.6.9...HEAD
[3.6.9]: https://github.com/koad/koad-io/compare/0.1.1...3.6.9
[0.1.1]: https://github.com/koad/koad-io/compare/0.1.0...0.1.1
[0.1.0]: https://github.com/koad/koad-io/compare/0.0.1...0.1.0
[0.0.1]: https://github.com/koad/koad-io/releases/tag/0.0.1
