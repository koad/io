#!/usr/bin/env bash
# kingdom forge — forge operations (mirror, org, clone, list, setup, etc.)
#
# Usage:
#   kingdom forge mirror <url> [--name=<name>] [--org=<org>] [--public]
#   kingdom forge org create <name> [--public]
#   kingdom forge org list
#   kingdom forge clone <path> [dir]
#   kingdom forge list
#   kingdom forge setup
#   kingdom forge config
#   kingdom forge remote
#   kingdom forge info

echo "Kingdom forge — git.koad.live"
echo ""
echo "Sub-commands:"
echo "  mirror <url>          Mirror external repo (default: private)"
echo "  org create <name>     Create org/category (default: private)"
echo "  org list              List orgs"
echo "  clone <path>          Git clone via kingdom: shortcut"
echo "  list                  List repos on the forge"
echo "  setup                 Configure git kingdom: shortcut"
echo "  config                Show forge URL config"
echo "  remote                Show CWD origin as kingdom:org/repo"
echo "  info                  Show forge connection info"
echo ""
echo "Run 'kingdom forge <sub> --help' for sub-command details."
