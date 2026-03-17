# Feature: Entity-powered Automations

## Summary
Entities can watch, react to, and log activity on any webpage. Users can define custom behaviors that trigger based on page content or user actions.

## Problem
Users want their entities to actively participate in their browsing - automating tasks, reacting to changes, and performing actions without manual intervention.

## Solution
Entity automations enable:
- Content observers on any webpage
- Action triggers based on page changes
- Event emission to entity's automation logic
- Custom scripts that run in browser context
- Logging and data capture triggered by events

## Implementation
- Entity defines automation rules in its configuration
- Rules are loaded into browser extension
- Content scripts monitor specified domains
- Events are emitted to entity via DDP
- Entity can execute responses through the extension

## Settings
- Automation rules defined in `passenger.json`
- Domain-specific rules supported
- Event types: page load, element change, form submit, etc.
- Custom JavaScript evaluation supported

## Status
- [x] Implemented

## Related Features
- Feature: 002-entity-selector.md
- Feature: 004-cross-website-memory.md
