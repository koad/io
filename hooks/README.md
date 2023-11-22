# Hooks Directory

## Overview

The `hooks` directory contains a collection of bash scripts designed for use with the koad:io CLI. These scripts are integral to customizing and extending the functionality of the koad:io tool.

## Customization

- Users are encouraged to modify these scripts to tailor the koad:io-cli experience to their specific needs.
- Each script serves a particular purpose within the CLI, and customizing them can significantly enhance your workflow.

## Guidelines for Modifying Scripts

- Before modifying, familiarize yourself with the script's current function.
- Test your changes thoroughly to ensure they don't disrupt the CLI's core functionality.
- Keep a backup of the original script before making any changes, in case you need to revert.

---

## The `executed-without-arguments.sh` hook 

When the `koad-io` command is executed without any arguments, this script:

1. Checks if `dotenv-cli` is installed, and if not, prompts the user to install it.
2. Loads an environment file specific to the entity being invoked and opens a new bash prompt with that environment. This allows for a customized environment tailored to the specific needs of the entity.

For example, if a user has a koad:io entity named `alice` and uses the command `alice` without adding any arguments, the script will load the environment variables from `~/.alice/.env`, then spawn a new bash prompt with these variables set.

This approach of dynamically setting environment variables based on the invoked entity provides a flexible and user-friendly way to manage different project/environment settings within the koad:io ecosystem.
