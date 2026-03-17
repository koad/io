# Feature: Chrome Extension UI

## Summary
The passenger extension provides a full Chrome extension interface including toolbar popup, options page, and content scripts for interacting with web pages.

## Problem
Users need an intuitive interface to interact with their passenger entities while browsing. The extension must integrate seamlessly with Chrome's UI paradigm.

## Solution
The Chrome extension UI includes:
- **Toolbar popup**: Quick access to passenger selection and status
- **Options page**: Configuration and preferences management
- **Content scripts**: Injected scripts for page interaction
- **Context menu**: Right-click actions for entity operations
- **Badge**: Visual indicator of current passenger

## Implementation
- Manifest V3 extension structure
- React-based popup UI (or vanilla JS)
- Chrome storage for preferences
- Content script injection for domain monitoring
- Icon badges for passenger status

## Settings
- Extension settings stored in Chrome storage
- Per-domain enable/disable
- Notification preferences
- Theme matching browser (dark/light)

## Status
- [x] Implemented

## Related Features
- Feature: 002-entity-selector.md
- Feature: 006-entity-automations.md
