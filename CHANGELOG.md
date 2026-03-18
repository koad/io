# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[Unreleased]: https://github.com/koad/koad-io/compare/v3.6.9...HEAD
[3.6.9]: https://github.com/koad/koad-io/compare/0.1.1...v3.6.9
[0.1.1]: https://github.com/koad/koad-io/compare/0.1.0...0.1.1
[0.1.0]: https://github.com/koad/koad-io/compare/0.0.1...0.1.0
[0.0.1]: https://github.com/koad/koad-io/releases/tag/0.0.1
