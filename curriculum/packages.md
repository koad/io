---
slug: packages
title: koad:io packages
shortTitle: Packages
level: Basic
difficulty: 10
blurb: How reusable templates, UIs, routes, styles, and data surfaces are built on top of commands and cascades.
hypothesis: Commands are the verbs; packages are the reusable rooms around those verbs.
---

## Hypothesis

Commands are the verbs; packages are the reusable rooms around those verbs.

## Problem

Applications often grow by copying UI fragments, helper functions, route handlers, and data assumptions from one surface into another. The result works locally but becomes hard to reuse.

## Solution served by koad:io

koad:io packages turn reusable behavior into portable Meteor package surfaces: templates, styles, helpers, publications, routes, and client logic.

## Technical model

- Templates define reusable UI surfaces.
- Routes can be registered by packages.
- Styles stay with the component they belong to.
- Data lands in shared namespaces such as `koad.library` and `koad.indexes`.

## Install / setup path

1. Identify a UI or data surface copied between apps.
2. Create a package with templates, styles, and client/server files.
3. Move reusable routes and rendering logic into the package.
4. Add the package to the host app's `.meteor/packages`.

## Verification

You should be able to install the package into a second app and get the same surface with minimal host-specific wiring.
