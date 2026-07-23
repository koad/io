#!/usr/bin/env bash
# koad-io kingdom — permissioned proxy for /kingdom/ goals and projects
#
# Usage:
#   koad-io kingdom goal list [--horizon=<level>]
#   koad-io kingdom goal show <slug>
#   koad-io kingdom goal context <slug>
#   koad-io kingdom goal status <slug> <state>
#   koad-io kingdom goal create <slug>
#   koad-io kingdom project list [--horizon=<level>]
#   koad-io kingdom project show <slug>
#   koad-io kingdom project context <slug>
#   koad-io kingdom project status <slug> <state>
#   koad-io kingdom project create <slug>
#   koad-io kingdom tree [--horizon=<level>]
#   koad-io kingdom link <project> <goal>
#   koad-io kingdom acl <slug> [--add <cid> | --remove <cid>]
#   koad-io kingdom forge ...
#
# See: ~/.juno/briefs/2026-07-23-kingdom-tooling.md

set -euo pipefail

# --- Config ---
KINGDOM_ROOT="/kingdom"
GOALS_DIR="${KINGDOM_ROOT}/goals"
PROJECTS_DIR="${KINGDOM_ROOT}/projects"
FM_PARSER="$(dirname "$0")/fm.py"
COMMAND_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

usage() {
    sed -n '2,16p' "$0" | sed 's/^# //'
    exit 0
}

die() { echo -e "${RED}Error:${NC} $*" >&2; exit 1; }

# Read frontmatter field via Python helper
fm_get() {
    local file="$1" field="$2"
    python3 "${COMMAND_DIR}/fm.py" get "$file" "$field" 2>/dev/null || echo "?"
}

fm_set() {
    local file="$1" field="$2" value="$3"
    python3 "${COMMAND_DIR}/fm.py" set "$file" "$field" "$value"
}

fm_add_list() {
    local file="$1" field="$2" value="$3"
    python3 "${COMMAND_DIR}/fm.py" add-list "$file" "$field" "$value"
}

slug_exists() {
    local type="$1" slug="$2"
    local filetype="${type}"
    # 'goals' directory contains 'goal.md', 'projects' contains 'project.md'
    [ "$type" = "goals" ] && filetype="goal"
    [ "$type" = "projects" ] && filetype="project"
    [ -d "${KINGDOM_ROOT}/${type}/${slug}" ] && [ -f "${KINGDOM_ROOT}/${type}/${slug}/${filetype}.md" ]
}

# --- Subcommands ---

cmd_goal_list() {
    local horizon=""
    local args=()
    for arg in "$@"; do
        if [[ "$arg" =~ ^--horizon=(.*)$ ]]; then
            horizon="${BASH_REMATCH[1]}"
        else
            args+=("$arg")
        fi
    done

    [ ! -d "$GOALS_DIR" ] && { echo "No goals directory"; exit 0; }

    printf "${BOLD}%-30s %-12s %-10s %s${NC}\n" "SLUG" "STATUS" "HORIZON" "PARTICIPANTS"
    printf "%s\n" "----------------------------------------------------------------"

    for dir in "$GOALS_DIR"/*/; do
        local slug
        slug=$(basename "$dir")
        local gfile="${dir}goal.md"
        [ ! -f "$gfile" ] && continue

        local status=$(fm_get "$gfile" "status")
        local horizon_val=$(fm_get "$gfile" "horizon")
        local participants=$(fm_get "$gfile" "participants")

        [ -n "$horizon" ] && [ "$horizon_val" != "$horizon" ] && continue

        local sc=""
        case "$status" in
            active)   sc="${GREEN}" ;;
            proposed) sc="${YELLOW}" ;;
            achieved|superseded) sc="${CYAN}" ;;
        esac

        printf "${sc}%-30s %-12s %-10s %s${NC}\n" "$slug" "$status" "$horizon_val" "$participants"
    done
}

cmd_goal_show() {
    [ $# -lt 1 ] && die "Usage: koad-io kingdom goal show <slug>"
    local slug="$1"
    slug_exists "goals" "$slug" || die "Goal '${slug}' not found"
    local file="${GOALS_DIR}/${slug}/goal.md"
    echo -e "${BOLD}=== ${slug} ===${NC}"
    echo ""
    python3 "${COMMAND_DIR}/fm.py" show "$file"
}

cmd_goal_context() {
    [ $# -lt 1 ] && die "Usage: koad-io kingdom goal context <slug> [--update]"
    local slug="$1"
    local update=false
    [ "${2:-}" = "--update" ] && update=true

    slug_exists "goals" "$slug" || die "Goal '${slug}' not found"
    local context_file="${GOALS_DIR}/${slug}/context.md"

    if $update; then
        [ -t 0 ] && die "Provide new context via stdin"
        local tmp; tmp=$(mktemp)
        cat > "$tmp"
        cp "$tmp" "$context_file"
        rm "$tmp"
        echo -e "${GREEN}✓${NC} context updated for ${slug}"
    else
        [ -f "$context_file" ] && cat "$context_file" || echo "(no context yet)"
    fi
}

cmd_goal_status() {
    [ $# -lt 2 ] && die "Usage: koad-io kingdom goal status <slug> <state>"
    local slug="$1" state="$2"
    slug_exists "goals" "$slug" || die "Goal '${slug}' not found"
    case "$state" in
        proposed|active|parked|achieved|superseded) ;;
        *) die "Invalid state '${state}'" ;;
    esac
    fm_set "${GOALS_DIR}/${slug}/goal.md" "status" "$state"
    echo -e "${GREEN}✓${NC} ${slug} status → ${state}"
}

cmd_goal_create() {
    [ $# -lt 1 ] && die "Usage: koad-io kingdom goal create <slug>"
    local slug="$1"
    slug_exists "goals" "$slug" && die "Goal '${slug}' already exists"

    local dir="${GOALS_DIR}/${slug}"
    mkdir -p "$dir"/{tickler,briefs,specs,assets}

    cat > "${dir}/goal.md" << GOALEOF
---
slug: ${slug}
title: ${slug}
status: proposed
horizon: 50k
parents: []
participants: [koad]
contributors: []
tags: []
success: []
---

# ${slug}

## Why

## What success looks like

## Current gap

## Next moves
GOALEOF

    echo "# Context" > "${dir}/context.md"
    cd "$dir" && git init && git add -A && git commit -m "scaffold: ${slug} goal" 2>/dev/null || true
    echo -e "${GREEN}✓${NC} Goal '${slug}' created at ${dir}"
}

# --- Projects (mirror goals) ---

cmd_project_list() {
    local horizon=""
    local args=()
    for arg in "$@"; do
        if [[ "$arg" =~ ^--horizon=(.*)$ ]]; then
            horizon="${BASH_REMATCH[1]}"
        fi
    done

    [ ! -d "$PROJECTS_DIR" ] && { echo "No projects directory"; exit 0; }

    printf "${BOLD}%-30s %-12s %-10s %s${NC}\n" "SLUG" "STATUS" "HORIZON" "PARTICIPANTS"
    printf "%s\n" "----------------------------------------------------------------"

    for dir in "$PROJECTS_DIR"/*/; do
        local slug=$(basename "$dir")
        local pfile="${dir}project.md"
        [ ! -f "$pfile" ] && continue

        local status=$(fm_get "$pfile" "status")
        local horizon_val=$(fm_get "$pfile" "horizon")
        local participants=$(fm_get "$pfile" "participants")

        [ -n "$horizon" ] && [ "$horizon_val" != "$horizon" ] && continue

        local sc=""
        case "$status" in
            active)   sc="${GREEN}" ;;
            proposed) sc="${YELLOW}" ;;
            achieved|superseded) sc="${CYAN}" ;;
        esac

        printf "${sc}%-30s %-12s %-10s %s${NC}\n" "$slug" "$status" "$horizon_val" "$participants"
    done
}

cmd_project_show() {
    [ $# -lt 1 ] && die "Usage: koad-io kingdom project show <slug>"
    local slug="$1"
    slug_exists "projects" "$slug" || die "Project '${slug}' not found"
    echo -e "${BOLD}=== ${slug} ===${NC}"
    echo ""
    python3 "${COMMAND_DIR}/fm.py" show "${PROJECTS_DIR}/${slug}/project.md"
}

cmd_project_context() {
    [ $# -lt 1 ] && die "Usage: koad-io kingdom project context <slug> [--update]"
    local slug="$1"
    local update=false
    [ "${2:-}" = "--update" ] && update=true
    slug_exists "projects" "$slug" || die "Project '${slug}' not found"
    local context_file="${PROJECTS_DIR}/${slug}/context.md"
    if $update; then
        [ -t 0 ] && die "Provide new context via stdin"
        local tmp; tmp=$(mktemp)
        cat > "$tmp"
        cp "$tmp" "$context_file"
        rm "$tmp"
        echo -e "${GREEN}✓${NC} context updated for ${slug}"
    else
        [ -f "$context_file" ] && cat "$context_file" || echo "(no context yet)"
    fi
}

cmd_project_status() {
    [ $# -lt 2 ] && die "Usage: koad-io kingdom project status <slug> <state>"
    local slug="$1" state="$2"
    slug_exists "projects" "$slug" || die "Project '${slug}' not found"
    case "$state" in
        proposed|active|parked|achieved|superseded) ;;
        *) die "Invalid state" ;;
    esac
    fm_set "${PROJECTS_DIR}/${slug}/project.md" "status" "$state"
    echo -e "${GREEN}✓${NC} ${slug} status → ${state}"
}

cmd_project_create() {
    [ $# -lt 1 ] && die "Usage: koad-io kingdom project create <slug>"
    local slug="$1"
    slug_exists "projects" "$slug" && die "Project '${slug}' already exists"

    local dir="${PROJECTS_DIR}/${slug}"
    mkdir -p "$dir"/{tickler,briefs,specs,assets}

    cat > "${dir}/project.md" << PROJEOF
---
slug: ${slug}
title: ${slug}
status: proposed
horizon: 40k
parents: []
participants: [koad]
contributors: []
tags: []
success: []
---

# ${slug}

## Purpose

## Scope

## Next moves
PROJEOF

    echo "# Context" > "${dir}/context.md"
    cd "$dir" && git init && git add -A && git commit -m "scaffold: ${slug} project" 2>/dev/null || true
    echo -e "${GREEN}✓${NC} Project '${slug}' created at ${dir}"
}

# --- Cross-cutting ---

cmd_tree() {
    local horizon=""
    for arg in "$@"; do
        [[ "$arg" =~ ^--horizon=(.*)$ ]] && horizon="${BASH_REMATCH[1]}"
    done

    echo -e "${BOLD}Kingdom Tree${NC}\n"

    echo -e "${YELLOW}Goals (50k)${NC}"
    echo "--------"
    for dir in "$GOALS_DIR"/*/; do
        [ ! -d "$dir" ] && continue
        local slug=$(basename "$dir")
        local gfile="${dir}goal.md"
        [ ! -f "$gfile" ] && continue
        local gstatus=$(fm_get "$gfile" "status")
        local ghorizon=$(fm_get "$gfile" "horizon")
        [ -n "$horizon" ] && [ "$ghorizon" != "$horizon" ] && continue
        echo -e "  ${BOLD}${slug}${NC} [${gstatus}] (${ghorizon})"

        for pdir in "$PROJECTS_DIR"/*/; do
            [ ! -d "$pdir" ] && continue
            local pslug=$(basename "$pdir")
            local pfile="${pdir}project.md"
            [ ! -f "$pfile" ] && continue
            local parents=$(fm_get "$pfile" "parents" 2>/dev/null || echo "")
            local phorizon=$(fm_get "$pfile" "horizon" 2>/dev/null || echo "?")
            [ -n "$horizon" ] && [ "$phorizon" != "$horizon" ] && continue
            if echo "$parents" | grep -q "${slug}"; then
                local pstatus=$(fm_get "$pfile" "status")
                echo -e "    └─ ${BOLD}${pslug}${NC} [${pstatus}] (${phorizon})"
            fi
        done
    done

    echo ""
    echo -e "${YELLOW}Unlinked Projects${NC}"
    echo "----------------"
    for pdir in "$PROJECTS_DIR"/*/; do
        [ ! -d "$pdir" ] && continue
        local pslug=$(basename "$pdir")
        local pfile="${pdir}project.md"
        [ ! -f "$pfile" ] && continue
        local parents=$(fm_get "$pfile" "parents" 2>/dev/null || echo "")
        local phorizon=$(fm_get "$pfile" "horizon")
        [ -n "$horizon" ] && [ "$phorizon" != "$horizon" ] && continue
        local linked=false
        for gdir in "$GOALS_DIR"/*/; do
            echo "$parents" | grep -q "$(basename "$gdir")" && linked=true && break
        done
        if ! $linked; then
            local pstatus=$(fm_get "$pfile" "status")
            echo -e "  ${BOLD}${pslug}${NC} [${pstatus}] (${phorizon})"
        fi
    done
}

cmd_link() {
    [ $# -lt 2 ] && die "Usage: koad-io kingdom link <project> <goal>"
    local project="$1" goal="$2"
    slug_exists "projects" "$project" || die "Project '${project}' not found"
    slug_exists "goals" "$goal" || die "Goal '${goal}' not found"
    fm_add_list "${PROJECTS_DIR}/${project}/project.md" "parents" "/kingdom/goals/${goal}"
    echo -e "${GREEN}✓${NC} Linked ${project} → ${goal}"
}

cmd_acl() {
    [ $# -lt 1 ] && die "Usage: koad-io kingdom acl <slug> [--add <cid> | --remove <cid>]"
    local slug="$1"
    local action="" cid=""
    [ "${2:-}" = "--add" ] && [ -n "${3:-}" ] && { action="add"; cid="$3"; }
    [ "${2:-}" = "--remove" ] && [ -n "${3:-}" ] && { action="remove"; cid="$3"; }

    local type=""
    local filetype=""
    slug_exists "goals" "$slug" && { type="goals"; filetype="goal"; }
    slug_exists "projects" "$slug" && { type="projects"; filetype="project"; }
    [ -z "$type" ] && die "No goal or project found for '${slug}'"
    local file="${KINGDOM_ROOT}/${type}/${slug}/${filetype}.md"

    if [ "$action" = "add" ]; then
        fm_add_list "$file" "contributors" "$cid"
        echo -e "${GREEN}✓${NC} Added contributor ${cid} to ${slug}"
    elif [ "$action" = "remove" ]; then
        python3 "${COMMAND_DIR}/fm.py" remove-list "$file" "contributors" "$cid"
        echo -e "${GREEN}✓${NC} Removed contributor ${cid} from ${slug}"
    else
        echo -e "${BOLD}ACL for ${slug}${NC}"
        python3 "${COMMAND_DIR}/fm.py" show-acl "$file"
    fi
}

# --- Router ---
main() {
    [ $# -eq 0 ] && { usage; exit 0; }
    local cmd="$1"; shift
    case "$cmd" in
        goal)
            [ $# -eq 0 ] && die "Usage: koad-io kingdom goal <list|show|context|status|create>"
            local sub="$1"; shift
            case "$sub" in
                list)    cmd_goal_list "$@" ;;
                show)    cmd_goal_show "$@" ;;
                context) cmd_goal_context "$@" ;;
                status)  cmd_goal_status "$@" ;;
                create)  cmd_goal_create "$@" ;;
                *)       die "Unknown goal subcommand: ${sub}" ;;
            esac
            ;;
        project)
            [ $# -eq 0 ] && die "Usage: koad-io kingdom project <list|show|context|status|create>"
            local sub="$1"; shift
            case "$sub" in
                list)    cmd_project_list "$@" ;;
                show)    cmd_project_show "$@" ;;
                context) cmd_project_context "$@" ;;
                status)  cmd_project_status "$@" ;;
                create)  cmd_project_create "$@" ;;
                *)       die "Unknown project subcommand: ${sub}" ;;
            esac
            ;;
        tree)  cmd_tree "$@" ;;
        link)  cmd_link "$@" ;;
        acl)   cmd_acl "$@" ;;
        help|--help|-h) usage ;;
        *) die "Unknown: ${cmd}. Try: goal, project, tree, link, acl, forge" ;;
    esac
}

main "$@"
