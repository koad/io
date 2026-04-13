# README for `start` Command

## Overview

The `start` command, part of the `koad:io` suite, is a versatile script designed to start applications in a dynamic and customizable environment. It is tailored for Meteor-based applications but can be adapted for various development frameworks and languages. The script handles environment verification, sets necessary variables, and launches the application in the appropriate mode based on the development environment.

## Features

- **Argument Handling**: Displays the arguments passed to the script.
- **Environment Validation**: Asserts a valid `koad:io` workspace and checks for required environmental variables.
- **Dynamic Settings File Selection**: Chooses the appropriate settings file based on the current environment.
- **Application Launching**: Decides whether to launch a built version of the application or start the Meteor compiler for development.
- **Custom Terminal Title**: Sets the terminal title to reflect the current running application.

## Usage

```bash
# Production (from built bundle):
alice start

# Local development (Meteor compiler):
alice start --local
alice start local          # positional form also works

# Local dev, stay attached to screen (see output live):
alice start --local --attach
```

### Flags

| Flag | Effect |
|------|--------|
| `--local` | Start in local development mode (Meteor compiler) instead of built bundle |
| `--attach` | Keep the screen session attached (foreground) instead of detaching |

### Screen lifecycle

The `start` command always runs inside a `screen` session. Use `screen -list` to check if it's running, `screen -r <name>` to attach, and `screen -S <name> -X quit` to stop it. To restart: kill the screen and re-invoke through the launcher.

## Script Breakdown

1. **Workspace Validation**: Ensures the script is running within a valid `koad:io` workspace.
2. **Required Variables Check**: Verifies the existence of essential environment variables for the script to run properly.
3. **Settings File Handling**: Determines and verifies the settings file to be used for the application.
4. **Application Launch Logic**:
   - **Production Mode**: If a built application is detected, it starts the service using environment variables derived from the settings file.
   - **Development Mode**: If a Meteor development environment is detected, it starts the Meteor compiler.
5. **Error Handling**: Provides feedback if essential variables or files are missing, or if the application cannot be found.

## Customization

This script serves as a template and can be modified to fit different development environments. Users can adapt it to start applications in other frameworks or languages by modifying the conditional logic and the commands used for starting the application.

For example, to adapt this script for a Node.js or python application, you would replace the Meteor-specific commands with Node.js commands and adjust the environment variable checks accordingly.
