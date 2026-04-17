# PRIMER: assets/

## What is this directory?

Static brand assets for the koad:io framework. This is the canonical source for logos, icons, and splash images used across koad:io products and entity UIs.

## What does it contain?

- `icon.png` — App icon (square format, used for PWA manifests and app launchers)
- `logo.png` — Full horizontal logo
- `original.png` — Source/original artwork before resizing
- `splash.png` — Splash screen image used for PWA loading screens

## Who works here?

Vulcan places new assets here when the brand evolves. Passenger and any Meteor app in the ecosystem references these files for PWA manifest generation and browser UI. Do not edit these without coordination — they propagate to all product surfaces.

## What to know before touching anything?

These files are referenced by path in multiple places (passenger.json configs, Meteor public folders, entity UIs). Renaming or removing a file without updating all references will silently break icons across the surface. Changes should be coordinated with Vulcan.
