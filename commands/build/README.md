# README for `build` Command

## Overview

The `build` command, part of the `koad:io` suite, is designed to build Meteor applications either as a tarball package for production deployment or as a local directory for development purposes. This command streamlines the process of preparing your application for different environments, ensuring a consistent and reliable build process.

## Usage

```bash
alice build [local]
```

- `local`: Optional argument. If provided, the script builds a local directory bundle instead of a tarball package.

## Script Breakdown

1. **Workspace and Environment Check**: Validates the `koad:io` workspace and checks for required environment variables.
2. **Build Preparation**: Sets up the build directory and navigates to the source directory.
3. **Build Execution**:
   - **Tarball Package**: If no `local` argument is provided or `LOCAL_BUILD` is `false`, a tarball package is built for production deployment.
   - **Local Directory Bundle**: If `local` argument is provided or `LOCAL_BUILD` is `true`, a local directory bundle is built, suitable for development and testing.
4. **Post-Build Actions**: In the case of a local bundle, runs npm install and update commands to ensure dependencies are correctly set up.
5. **Build Pointer Update**: Updates a symbolic link to point to the latest build.
6. **Build Completion Summary**: Displays build success message, size of the built package, and total build time.

## Customization

While this script is tailored for Meteor applications, it can be customized to suit other development frameworks. Users can modify the build commands and post-build processing steps to align with their specific project requirements.

For example, to adapt this script for a Node.js application, you would replace Meteor-specific build commands with corresponding Node.js build steps, and adjust the post-build processing as needed.

