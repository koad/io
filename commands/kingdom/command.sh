#!/usr/bin/env bash
# koad-io kingdom — permissioned proxy for the /kingdom canon
#
# Four vantage points on one body of work (convention, 3rd amendment): a goal is
# where it is going, a project the vehicle, a component what it is built out of,
# a case whose need it serves. All four are mutated only through this command
# (rule 5) — components and cases gained their verbs on 2026-10-09, having
# previously been hand-edited.
#
# Usage:
#   koad-io kingdom goal list [--horizon=<level>]
#   koad-io kingdom goal show <slug>
#   koad-io kingdom goal context <slug> [--update] [--commit]
#   koad-io kingdom goal status <slug> <state> [--commit]
#   koad-io kingdom goal create <slug>
#   koad-io kingdom goal field <slug> <key> <value>
#   koad-io kingdom goal field-add <slug> <key> <value>
#   koad-io kingdom goal field-remove <slug> <key> <value>
#   koad-io kingdom goal key-rm <slug> <key>
#   koad-io kingdom goal body <slug>            (new body on stdin)
#   koad-io kingdom project list [--horizon=<level>]
#   koad-io kingdom project show <slug>
#   koad-io kingdom project context <slug> [--update] [--commit]
#   koad-io kingdom project status <slug> <state> [--commit]
#   koad-io kingdom project create <slug>
#   koad-io kingdom project field <slug> <key> <value>
#   koad-io kingdom project field-add <slug> <key> <value>
#   koad-io kingdom project field-remove <slug> <key> <value>
#   koad-io kingdom project key-rm <slug> <key>
#   koad-io kingdom project body <slug>         (new body on stdin)
#   koad-io kingdom component list
#   koad-io kingdom component show <slug>
#   koad-io kingdom component context <slug> [--update] [--commit]
#   koad-io kingdom component status <slug> <state> [--commit]
#   koad-io kingdom component create <slug> [--repo=<path>] [--remote=<url>]
#   koad-io kingdom component field <slug> <key> <value>
#   koad-io kingdom component field-add <slug> <key> <value>
#   koad-io kingdom component field-remove <slug> <key> <value>
#   koad-io kingdom component key-rm <slug> <key>
#   koad-io kingdom component body <slug>       (new body on stdin)
#   koad-io kingdom case list
#   koad-io kingdom case show <slug>
#   koad-io kingdom case context <slug> [--update] [--commit]
#   koad-io kingdom case status <slug> <state> [--commit]
#   koad-io kingdom case create <slug> [--for=<handle>]
#   koad-io kingdom case field <slug> <key> <value>
#   koad-io kingdom case field-add <slug> <key> <value>
#   koad-io kingdom case field-remove <slug> <key> <value>
#   koad-io kingdom case key-rm <slug> <key>
#   koad-io kingdom case body <slug>            (new body on stdin)
#   koad-io kingdom commit <slug> [-m <message>]
#   koad-io kingdom tree [--horizon=<level>]
#   koad-io kingdom check
#   koad-io kingdom link <project> <goal>
#   koad-io kingdom acl <slug> [--add <cid> | --remove <cid>]
#   koad-io kingdom forge ...
#   koad-io kingdom packages list
#   koad-io kingdom packages clone <name> [--from=<path>]
#   koad-io kingdom packages status <name>
#   koad-io kingdom packages diff <name>
#   koad-io kingdom contacts list
#   koad-io kingdom contacts show <handle>
#   koad-io kingdom contacts add <url> [--org=<org>]
#   koad-io kingdom contacts sync <handle>
#
#   koad-io kingdom calendar list [--date=<ISO>] [--month=<YYYY-MM>]
#   koad-io kingdom calendar show <slug> [--date=<ISO>]
#   koad-io kingdom calendar pin <date> <title> [--ref=<ref>] [--refs=<list>] [--tags=<list>]
#
#   koad-io kingdom commitment list [--type=expense|meeting]
#   koad-io kingdom commitment show <slug>
#   koad-io kingdom commitment add <slug> <title> [--type=expense|meeting] [--amount=<N>] [--currency=<C>] [--frequency=<Nd>] [--schedule=<weekly|monthly>] [--day=<Monday>] [--time=<HH:MM>] [--timezone=<zone>] [--participants=<list>]
#   koad-io kingdom commitment tick <slug>
#   koad-io kingdom commitment cancel <slug>
#
# See: ~/.juno/briefs/2026-07-23-kingdom-tooling.md

set -euo pipefail

# --- Config ---
KINGDOM_ROOT="${KOAD_IO_KINGDOM_ROOT:-/kingdom}"
GOALS_DIR="${KINGDOM_ROOT}/goals"
PROJECTS_DIR="${KINGDOM_ROOT}/projects"
COMPONENTS_DIR="${KINGDOM_ROOT}/components"
CASES_DIR="${KINGDOM_ROOT}/cases"
CONTACTS_DIR="${KINGDOM_ROOT}/contacts"
PACKAGES_DIR="${KINGDOM_ROOT}/packages"
CALENDAR_DIR="${KINGDOM_ROOT}/calendar"
COMMITMENTS_DIR="${KINGDOM_ROOT}/commitments"
FRAMEWORK_PACKAGES_DIR="${KOAD_IO_FRAMEWORK_PACKAGES:-$HOME/.forge/packages}"
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
    # Print the header comment block: line 2 up to the first non-comment line.
    # The old form hard-coded `sed -n '2,52p'`, which silently truncated help the
    # moment a line was added to the header — and twenty just were.
    awk 'NR==1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"
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

# --- Container resolution ---
# A project may be a sub-container nested one level inside a parent project: the
# folder is the local short name, the slug is `<parent-slug>-<short>` (convention,
# sub-container rule). Resolve a slug to its directory by trying the top level
# first, then one level of nesting.
resolve_project_dir() {  # slug -> prints the container dir, nonzero if absent
    local slug="$1" d parent child top
    top="${PROJECTS_DIR}/${slug}"
    if [ -f "${top}/project.md" ]; then printf '%s' "$top"; return 0; fi
    for d in "${PROJECTS_DIR}"/*/*/; do
        [ -f "${d}project.md" ] || continue
        parent="$(basename "$(dirname "${d%/}")")"
        child="$(basename "${d%/}")"
        if [ "${parent}-${child}" = "$slug" ]; then printf '%s' "${d%/}"; return 0; fi
    done
    for d in "${PROJECTS_DIR}"/*/*/; do
        [ -f "${d}project.md" ] || continue
        if [ "$(fm_get "${d}project.md" slug)" = "$slug" ]; then printf '%s' "${d%/}"; return 0; fi
    done
    return 1
}

# A goal lives at /kingdom/goals/<slug> — or, for the source, at /kingdom/100k/<slug>.
# A 100k container IS `kind: goal` at horizon 100k; it was simply the one container the
# CLI could not reach ('Goal not found'), which blocked a real unit walk on 2026-10-09
# and forced a hand-edit through fm.py — the path rule 5 exists to prevent (open-027).
# Not a fourth type: a second root for the type it already is.
resolve_goal_dir() {  # slug -> prints the container dir
    local slug="$1"
    if [ -f "${GOALS_DIR}/${slug}/goal.md" ]; then printf '%s' "${GOALS_DIR}/${slug}"; return 0; fi
    if [ -f "${KINGDOM_ROOT}/100k/${slug}/goal.md" ]; then printf '%s' "${KINGDOM_ROOT}/100k/${slug}"; return 0; fi
    printf '%s' "${GOALS_DIR}/${slug}"
}

dir_of() {  # type(goal|project|component|case) slug -> prints the container dir
    case "$1" in
        goal)      resolve_goal_dir "$2" ;;
        component) printf '%s' "${COMPONENTS_DIR}/${2}" ;;
        case)      printf '%s' "${CASES_DIR}/${2}" ;;
        *)         resolve_project_dir "$2" ;;
    esac
}

slug_exists() {
    local type="$1" slug="$2" filetype d
    case "$type" in
        goals|goal)           filetype="goal";      d=$(resolve_goal_dir "$slug") ;;
        components|component) filetype="component"; d="${COMPONENTS_DIR}/${slug}" ;;
        cases|case)           filetype="case";      d="${CASES_DIR}/${slug}" ;;
        *)                    filetype="project";   d=$(resolve_project_dir "$slug") || return 1 ;;
    esac
    [ -f "${d}/${filetype}.md" ]
}

# --- Git commit helper ---
# Initialise a fresh container's repo and land the scaffold commit.
#
# Never swallows a failure. The previous form was
#     cd "$dir" && git init && git add -A && git commit -m "…" 2>/dev/null || true
# where `2>/dev/null || true` made a broken `git init` indistinguishable from a
# working one — which is how containers ended up with no history while the CLI
# reported success. `git -C` replaces `cd` so the caller's cwd is never mutated.
init_bubble() {
    local type="$1" slug="$2"
    local dir
    dir=$(dir_of "$type" "$slug")

    if ! git -C "$dir" init -q; then
        echo -e "${RED}✗${NC} git init failed: ${dir} — container created WITHOUT history" >&2
        return 1
    fi
    if ! git -C "$dir" add -A; then
        echo -e "${RED}✗${NC} git add failed: ${dir} — repo initialised, content unstaged" >&2
        return 1
    fi
    if git -C "$dir" commit -q -m "scaffold: ${slug} ${type}"; then
        echo -e "${GREEN}✓${NC} repo initialised: ${dir}"
    else
        echo -e "${YELLOW}⚠${NC} repo initialised but nothing committed: ${dir}" >&2
    fi
    return 0
}

# Commit one bubble. Reports what actually happened:
#   0  committed, or nothing staged (nothing to commit is not a failure)
#   1  no repo, or git add/commit genuinely failed
#
# Two live defects fixed here. (1) The success line printed unconditionally —
# `kingdom commit counsel` announced "nothing to commit" and then claimed
# "✓ committed" in the same breath. (2) `cd "$dir"` left the caller standing
# inside the container for the rest of the script. `git -C` removes the side
# effect; the explicit tests remove the false success.
commit_bubble() {
    local type="$1" slug="$2" summary="$3"
    local dir
    dir=$(dir_of "$type" "$slug")
    if [ ! -d "${dir}/.git" ]; then
        echo -e "${YELLOW}⚠${NC} ${dir} is not a git repository — skipping commit" >&2
        return 1
    fi
    if ! git -C "$dir" add -A; then
        echo -e "${RED}✗${NC} git add failed: ${type}(${slug})" >&2
        return 1
    fi
    if git -C "$dir" diff --cached --quiet; then
        echo -e "${YELLOW}⚠${NC} nothing to commit: ${type}(${slug})" >&2
        return 0
    fi
    if git -C "$dir" commit -q -m "${type}(${slug}): ${summary}"; then
        echo -e "${GREEN}✓${NC} committed: ${type}(${slug}): ${summary}"
    else
        echo -e "${RED}✗${NC} commit failed: ${type}(${slug}): ${summary}" >&2
        return 1
    fi
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

    [ ! -d "$GOALS_DIR" ] && [ ! -d "${KINGDOM_ROOT}/100k" ] && { echo "No goals directory"; exit 0; }

    printf "${BOLD}%-30s %-12s %-10s %s${NC}\n" "SLUG" "STATUS" "HORIZON" "PARTICIPANTS"
    printf "%s\n" "----------------------------------------------------------------"

    # Two roots, one kind. /kingdom/100k/<slug>/goal.md IS a goal at horizon
    # 100k (see resolve_goal_dir, which already reaches it) — so a list that
    # reads only /kingdom/goals omits a goal the same command can `show`. The
    # read model indexes both; this has to match or the page and the CLI
    # disagree about how many goals exist.
    local root dir slug gfile status horizon_val participants sc
    for root in "$GOALS_DIR" "${KINGDOM_ROOT}/100k"; do
        [ -d "$root" ] || continue
        for dir in "$root"/*/; do
            slug=$(basename "$dir")
            gfile="${dir}goal.md"
            [ ! -f "$gfile" ] && continue

            status=$(fm_get "$gfile" "status")
            horizon_val=$(fm_get "$gfile" "horizon")
            participants=$(fm_get "$gfile" "participants")

            [ -n "$horizon" ] && [ "$horizon_val" != "$horizon" ] && continue

            sc=""
            case "$status" in
                active)   sc="${GREEN}" ;;
                standing) sc="${GREEN}" ;;
                proposed) sc="${YELLOW}" ;;
                achieved|superseded) sc="${CYAN}" ;;
            esac

            printf "${sc}%-30s %-12s %-10s %s${NC}\n" "$slug" "$status" "$horizon_val" "$participants"
        done
    done
}

cmd_goal_show() {
    [ $# -lt 1 ] && die "Usage: koad-io kingdom goal show <slug>"
    local slug="$1"
    slug_exists "goals" "$slug" || die "Goal '${slug}' not found"
    local file="$(dir_of goal "$slug")/goal.md"
    echo -e "${BOLD}=== ${slug} ===${NC}"
    echo ""
    python3 "${COMMAND_DIR}/fm.py" show "$file"
}

cmd_goal_context() {
    local commit=false update=false
    local args=()
    for arg in "$@"; do
        case "$arg" in
            --commit) commit=true ;;
            --update) update=true ;;
            *) args+=("$arg") ;;
        esac
    done
    set -- "${args[@]}"

    [ $# -lt 1 ] && die "Usage: koad-io kingdom goal context <slug> [--update] [--commit]"
    local slug="$1"

    slug_exists "goals" "$slug" || die "Goal '${slug}' not found"
    local context_file="$(dir_of goal "$slug")/context.md"

    if $update; then
        [ -t 0 ] && die "Provide new context via stdin"
        local tmp; tmp=$(mktemp)
        cat > "$tmp"
        cp "$tmp" "$context_file"
        rm "$tmp"
        echo -e "${GREEN}✓${NC} context updated for ${slug}"
        if $commit; then commit_bubble "goal" "$slug" "update context"; fi
    else
        [ -f "$context_file" ] && cat "$context_file" || echo "(no context yet)"
    fi
}

cmd_goal_status() {
    local commit=false
    local args=()
    for arg in "$@"; do
        [ "$arg" = "--commit" ] && commit=true || args+=("$arg")
    done
    set -- "${args[@]}"

    [ $# -lt 2 ] && die "Usage: koad-io kingdom goal status <slug> <state> [--commit]"
    local slug="$1" state="$2"
    slug_exists "goals" "$slug" || die "Goal '${slug}' not found"
    case "$state" in
        # Canon status vocabulary — ~/.juno/briefs/2026-07-23-kingdom-fs-convention.md,
        # amended 2026-09-27 (koad directive). `standing` = a continuous capability
        # rather than bounded work. Ten containers use it and this validator used to
        # reject it, which made them untransitionable by the only tool that owns
        # status. Health signals (degraded, broken) are NOT status — they belong in
        # cockpit sitrep flags beside blocked/held/unassigned/overlooked.
        proposed|active|standing|parked|achieved|superseded) ;;
        *) die "Invalid state '${state}'" ;;
    esac
    fm_set "$(dir_of goal "$slug")/goal.md" "status" "$state"
    echo -e "${GREEN}✓${NC} ${slug} status → ${state}"
    if $commit; then commit_bubble "goal" "$slug" "status → ${state}"; fi
}

cmd_goal_create() {
    [ $# -lt 1 ] && die "Usage: koad-io kingdom goal create <slug>"
    local slug="$1"
    slug_exists "goals" "$slug" && die "Goal '${slug}' already exists"

    local dir; dir="$(dir_of goal "$slug")"
    mkdir -p "$dir"/{questions,tickler,briefs,specs,assets}

    cat > "${dir}/goal.md" << GOALEOF
---
slug: ${slug}
kind: goal
title: ${slug}
status: proposed
horizon: 50k
participants: [koad]
contributors: []
parents: []
signed: false
created: $(date +%F)
updated: $(date +%F)
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
    init_bubble "goal" "$slug"
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

    # sub-containers (nested one level inside a parent project)
    for dir in "$PROJECTS_DIR"/*/*/; do
        local pfile="${dir}project.md"
        [ ! -f "$pfile" ] && continue
        local s_slug=$(fm_get "$pfile" "slug")
        local s_status=$(fm_get "$pfile" "status")
        local s_horizon=$(fm_get "$pfile" "horizon")
        local s_parts=$(fm_get "$pfile" "participants")
        [ -n "$horizon" ] && [ "$s_horizon" != "$horizon" ] && continue
        local sc2=""
        case "$s_status" in
            active)   sc2="${GREEN}" ;;
            proposed) sc2="${YELLOW}" ;;
            achieved|superseded) sc2="${CYAN}" ;;
        esac
        printf "${sc2}%-30s %-12s %-10s %s${NC}\n" "  ↳ ${s_slug}" "$s_status" "$s_horizon" "$s_parts"
    done
}

cmd_project_show() {
    [ $# -lt 1 ] && die "Usage: koad-io kingdom project show <slug>"
    local slug="$1"
    slug_exists "projects" "$slug" || die "Project '${slug}' not found"
    echo -e "${BOLD}=== ${slug} ===${NC}"
    echo ""
    python3 "${COMMAND_DIR}/fm.py" show "$(dir_of project "$slug")/project.md"
}

cmd_project_context() {
    local commit=false update=false
    local args=()
    for arg in "$@"; do
        case "$arg" in
            --commit) commit=true ;;
            --update) update=true ;;
            *) args+=("$arg") ;;
        esac
    done
    set -- "${args[@]}"

    [ $# -lt 1 ] && die "Usage: koad-io kingdom project context <slug> [--update] [--commit]"
    local slug="$1"
    slug_exists "projects" "$slug" || die "Project '${slug}' not found"
    local context_file="$(dir_of project "$slug")/context.md"
    if $update; then
        [ -t 0 ] && die "Provide new context via stdin"
        local tmp; tmp=$(mktemp)
        cat > "$tmp"
        cp "$tmp" "$context_file"
        rm "$tmp"
        echo -e "${GREEN}✓${NC} context updated for ${slug}"
        if $commit; then commit_bubble "project" "$slug" "update context"; fi
    else
        [ -f "$context_file" ] && cat "$context_file" || echo "(no context yet)"
    fi
}

cmd_project_status() {
    local commit=false
    local args=()
    for arg in "$@"; do
        [ "$arg" = "--commit" ] && commit=true || args+=("$arg")
    done
    set -- "${args[@]}"

    [ $# -lt 2 ] && die "Usage: koad-io kingdom project status <slug> <state> [--commit]"
    local slug="$1" state="$2"
    slug_exists "projects" "$slug" || die "Project '${slug}' not found"
    case "$state" in
        # Canon status vocabulary — ~/.juno/briefs/2026-07-23-kingdom-fs-convention.md,
        # amended 2026-09-27 (koad directive). See the goal validator for the full note.
        proposed|active|standing|parked|achieved|superseded) ;;
        *) die "Invalid state '${state}'" ;;
    esac
    fm_set "$(dir_of project "$slug")/project.md" "status" "$state"
    echo -e "${GREEN}✓${NC} ${slug} status → ${state}"
    if $commit; then commit_bubble "project" "$slug" "status → ${state}"; fi
}

cmd_project_create() {
    [ $# -lt 1 ] && die "Usage: koad-io kingdom project create <slug>"
    local slug="$1"
    slug_exists "projects" "$slug" && die "Project '${slug}' already exists"

    local dir="${PROJECTS_DIR}/${slug}"
    mkdir -p "$dir"/{questions,tickler,briefs,specs,assets}

    cat > "${dir}/project.md" << PROJEOF
---
slug: ${slug}
kind: project
title: ${slug}
status: proposed
horizon: 40k
participants: [koad]
contributors: []
parents: []
signed: false
created: $(date +%F)
updated: $(date +%F)
tags: []
---

# ${slug}

## Purpose

## Scope

## Next moves
PROJEOF

    echo "# Context" > "${dir}/context.md"
    init_bubble "project" "$slug"
    echo -e "${GREEN}✓${NC} Project '${slug}' created at ${dir}"
}

# --- Components & cases (references and needs — not altitude-ranked) ---
#
# Ratified 2026-09-27 (convention, 2nd amendment) and given NO tooling on
# purpose: "building a CLI, a scanner arm and four resource adapters before a
# single component or case exists is ceremony machinery without ceremony." This
# is that tooling, added the moment the registry stopped being empty.
#
# Rule 5 says the `koad-io kingdom` command is the permissioned proxy for ALL
# canon mutations. Two ratified kinds sat outside it, which is how the first two
# components came to be hand-created through fm.py — the exact path rule 5
# exists to prevent. These verbs close that.
#
# The two kinds share ONE shape: a flat container at /kingdom/<kindDir>/<slug>/
# holding <file> + context.md + tickler/briefs/specs/assets, with no horizon
# (neither is altitude-ranked) and no nesting. So they share one implementation
# parameterised by kind, rather than being duplicated the way goal/project are.
#
# `create` writes the ratified frontmatter shape and nothing more. It does not
# invent a repo, a consumer or a use-case — a component holds REFERENCES, never
# code, and `consumed-by` is deliberately left empty rather than guessed.

# kind (singular) → definition filename. The authority is cmd_check's case block.
_kind_file() {
    case "$1" in
        goal)      printf 'goal.md' ;;
        project)   printf 'project.md' ;;
        component) printf 'component.md' ;;
        case)      printf 'case.md' ;;
        *)         die "unknown container kind '${1}'" ;;
    esac
}

_kind_dir() {  # kind (singular) → kind dir
    case "$1" in
        component) printf 'components' ;;
        case)      printf 'cases' ;;
        *)         die "_kind_dir: '${1}' is not a flat kind" ;;
    esac
}

cmd_side_list() {  # kind
    local kind="$1"
    local dir="${KINGDOM_ROOT}/$(_kind_dir "$kind")"
    local file; file="$(_kind_file "$kind")"

    if [ ! -d "$dir" ]; then
        echo "No ${kind} containers yet (${dir} does not exist)"
        return 0
    fi

    printf "${BOLD}%-28s %-10s %s${NC}\n" "SLUG" "STATUS" "TITLE"
    printf "%s\n" "------------------------------------------------------------------------"

    local d slug status title sc
    for d in "$dir"/*/; do
        [ -d "$d" ] || continue
        slug=$(basename "$d")
        [ -f "${d}${file}" ] || continue
        status=$(fm_get "${d}${file}" "status")
        title=$(fm_get "${d}${file}" "title")
        sc=""
        case "$status" in
            active|standing)     sc="${GREEN}" ;;
            proposed)            sc="${YELLOW}" ;;
            achieved|superseded) sc="${CYAN}" ;;
        esac
        printf "${sc}%-28s %-10s %s${NC}\n" "$slug" "$status" "$title"
    done
}

cmd_side_show() {  # kind slug
    local kind="$1" slug="${2:-}"
    [ -n "$slug" ] || die "Usage: koad-io kingdom ${kind} show <slug>"
    slug_exists "$kind" "$slug" || die "${kind} '${slug}' not found"
    local file; file="$(_bubble_path "$kind" "$slug")"
    echo -e "${BOLD}=== ${slug} ===${NC}"
    echo ""
    python3 "${COMMAND_DIR}/fm.py" show "$file"
}

cmd_side_context() {  # kind slug [--update] [--commit]
    local kind="$1"; shift
    local commit=false update=false
    local args=()
    for arg in "$@"; do
        case "$arg" in
            --commit) commit=true ;;
            --update) update=true ;;
            *) args+=("$arg") ;;
        esac
    done
    set -- "${args[@]}"

    local slug="${1:-}"
    [ -n "$slug" ] || die "Usage: koad-io kingdom ${kind} context <slug> [--update] [--commit]"
    slug_exists "$kind" "$slug" || die "${kind} '${slug}' not found"

    local context_file; context_file="$(dir_of "$kind" "$slug")/context.md"
    if $update; then
        [ -t 0 ] && die "Provide new context via stdin"
        local tmp; tmp=$(mktemp)
        cat > "$tmp"
        cp "$tmp" "$context_file"
        rm "$tmp"
        echo -e "${GREEN}✓${NC} context updated for ${slug}"
        if $commit; then commit_bubble "$kind" "$slug" "update context"; fi
    else
        if [ -f "$context_file" ]; then cat "$context_file"; else echo "(no context yet)"; fi
    fi
}

cmd_side_status() {  # kind slug state [--commit]
    local kind="$1"; shift
    local commit=false
    local args=()
    for arg in "$@"; do
        [ "$arg" = "--commit" ] && commit=true || args+=("$arg")
    done
    set -- "${args[@]}"

    local slug="${1:-}" state="${2:-}"
    [ -n "$slug" ] && [ -n "$state" ] || die "Usage: koad-io kingdom ${kind} status <slug> <state> [--commit]"
    slug_exists "$kind" "$slug" || die "${kind} '${slug}' not found"
    case "$state" in
        # ONE status vocabulary, four sets of meanings (convention, 3rd
        # amendment). At these two vantage points: proposed = planned-not-adopted
        # / reported-not-triaged; achieved = settled into use / resolved;
        # standing = stable-and-maintained / a recurring need. The vocabulary is
        # shared on purpose — a second list for one field is the failure the
        # convention already had to amend once.
        proposed|active|standing|parked|achieved|superseded) ;;
        *) die "Invalid state '${state}'" ;;
    esac
    fm_set "$(_bubble_path "$kind" "$slug")" "status" "$state"
    echo -e "${GREEN}✓${NC} ${slug} status → ${state}"
    if $commit; then commit_bubble "$kind" "$slug" "status → ${state}"; fi
}

cmd_side_create() {  # kind slug [--repo=<path>] [--remote=<url>] [--for=<handle>]
    local kind="$1"; shift
    local repo="" remote="" for_handle="" slug=""
    local args=()
    for arg in "$@"; do
        case "$arg" in
            --repo=*)   repo="${arg#--repo=}" ;;
            --remote=*) remote="${arg#--remote=}" ;;
            --for=*)    for_handle="${arg#--for=}" ;;
            *)          args+=("$arg") ;;
        esac
    done
    slug="${args[0]:-}"
    [ -n "$slug" ] || die "Usage: koad-io kingdom ${kind} create <slug> [--repo=<path>] [--remote=<url>] [--for=<handle>]"
    slug_exists "$kind" "$slug" && die "${kind} '${slug}' already exists"

    local dir; dir="$(dir_of "$kind" "$slug")"
    mkdir -p "$dir"/{questions,tickler,briefs,specs,assets}

    if [ "$kind" = "component" ]; then
        {
            echo "---"
            echo "slug: ${slug}"
            echo "kind: component"
            echo "title: ${slug}"
            echo "status: proposed"
            # Emitted only when known. An empty `repo:` line parses as a block
            # list, not an empty scalar — and a component with no repo yet is
            # honestly "unknown", not "empty list".
            if [ -n "$repo" ];   then echo "repo: ${repo}"; fi
            if [ -n "$remote" ]; then echo "remote: ${remote}"; fi
            echo "stack: []"
            echo "consumed-by: []"
            echo "contributors: []"
            echo "signed: false"
            echo "created: $(date +%F)"
            echo "updated: $(date +%F)"
            echo "tags: []"
            echo "---"
            echo ""
            echo "# ${slug}"
            echo ""
            echo "## What it is"
            echo ""
            echo "## Where it lives"
            echo ""
            echo "## Who consumes it"
        } > "${dir}/component.md"
    else
        {
            echo "---"
            echo "slug: ${slug}"
            echo "kind: case"
            echo "title: ${slug}"
            echo "status: proposed"
            if [ -n "$for_handle" ]; then echo "for: [${for_handle}]"; else echo "for: []"; fi
            echo "relates-to: []"
            echo "opened: $(date +%F)"
            echo "contributors: []"
            echo "signed: false"
            echo "created: $(date +%F)"
            echo "updated: $(date +%F)"
            echo "tags: []"
            echo "---"
            echo ""
            echo "# ${slug}"
            echo ""
            echo "## The need"
            echo ""
            echo "## What would resolve it"
            echo ""
            echo "## Notes"
        } > "${dir}/case.md"
    fi

    echo "# Context" > "${dir}/context.md"
    init_bubble "$kind" "$slug"
    echo -e "${GREEN}✓${NC} ${kind} '${slug}' created at ${dir}"
}

# --- Cross-cutting ---

# Canon integrity check. Surfaces the drift hand-maintained canon accumulates
# silently: a container missing `kind`; a context.md that is absent or a stub;
# a parent path that does not resolve; a goal whose body "Projects serving this
# goal" names a project that does not actually parent to it (informational and
# structural relation drifting apart).
cmd_check() {
    local issues=0 dir sdir

    _check_one() {  # containerDir label kindDir
        local cdir="$1" slug="$2" kindDir="$3" dir file p rel path n pf c fld
        dir="$cdir"
        # Five container kinds now, not three. Components and cases were ratified
        # 2026-09-27 and had NO containers until 2026-10-09 — the day canon's first
        # two components were created by hand BECAUSE this linter could not see them.
        # A check that reports clean over an incomplete universe is the open-019
        # failure with a different subject (shape 10: name the universe before you
        # name the result). They are inside it now.
        case "$kindDir" in
            goals|100k) file="${dir}/goal.md" ;;
            components) file="${dir}/component.md" ;;
            cases)      file="${dir}/case.md" ;;
            entities)   file="${dir}/entity.md" ;;
            contacts)   file="${dir}/contact.md" ;;
            *)          file="${dir}/project.md" ;;
        esac
        if [ ! -f "$file" ]; then return 0; fi
        for fld in kind signed created updated; do
            if ! grep -q "^${fld}:" "$file"; then
                echo "  [field]   ${kindDir}/${slug}: missing ${fld}"; issues=$((issues+1))
            fi
        done
        # A DUPLICATED frontmatter block. `fm.py` splits on the FIRST two `---`
        # (content.split('---', 2)), so a second block lands inside the "body" and
        # survives every read/write round-trip — and both `kingdom show` and this
        # check read only the first block, so nothing saw it. Two containers
        # carried one until 2026-10-10 (kingdom-fs/tooling, kingofalldata-pwa).
        # A `---` line followed by a `slug:` line is a block, not a horizontal rule:
        # pi-integration and chiron-curriculum-spec each carry a legitimate `---`
        # rule in the body and must NOT be flagged.
        if awk '
            NR==1 && /^---[[:space:]]*$/ { fm=1; next }
            fm==1 && /^---[[:space:]]*$/ { fm=2; next }
            fm==2 && /^---[[:space:]]*$/ { pending=1; next }
            fm==2 && pending {
                if ($0 ~ /^[[:space:]]*$/) next
                if ($0 ~ /^slug:/) { print "dup"; exit }
                pending=0
            }
        ' "$file" | grep -q dup; then
            echo "  [frontmatter] ${kindDir}/${slug}: duplicated frontmatter block"; issues=$((issues+1))
        fi
        # Non-standard keys. The sanctioned set is the canon key order
        # (fm.py KEY_ORDER / the write adapter's CANON_KEY_ORDER) plus
        # `relates-to`, which is the one cross-reference the convention
        # sanctions by name (6th amendment) and which canon orders last.
        # `success` is a goal field — it does not belong on a project.
        # Added 2026-10-09 (open-022): the 6th amendment claimed this check
        # existed; it did not, which is how HAA kept two keys the same
        # amendment named.
        local allowed=" slug kind title status signed created updated tags relates-to "
        case "$kindDir" in
            goals|100k)  allowed="$allowed horizon participants contributors parents success " ;;
            projects)    allowed="$allowed horizon participants contributors parents " ;;
            components)  allowed="$allowed repo remote stack consumed-by contributors " ;;
            cases)       allowed="$allowed for opened contributors " ;;
            entities)    allowed="$allowed handle home remote role contributors " ;;
            contacts)    allowed="$allowed handle org role origins contributors " ;;
        esac
        while IFS= read -r k; do
            [ -z "$k" ] && continue
            case "$allowed" in
                *" $k "*) ;;
                *) echo "  [key]     ${kindDir}/${slug}: non-standard key '${k}'"; issues=$((issues+1)) ;;
            esac
        done < <(awk 'NR==1 && /^---[[:space:]]*$/{f=1;next} f && /^---[[:space:]]*$/{exit} f && /^[A-Za-z0-9_-]+:/{k=$0;sub(/:.*/,"",k);print k}' "$file")
        if [ ! -f "${dir}/context.md" ]; then
            echo "  [context] ${kindDir}/${slug}: no context.md"; issues=$((issues+1))
        else
            # Content lines only: blank lines and headings do not count. The
            # heading was being counted as content, so a context with a title and
            # one line passed the stub test (2026-10-09, canon walk).
            c=$(awk 'BEGIN{fm=0;c=0} /^---[[:space:]]*$/{fm++;next} {if((fm==0||fm>=2)&&NF && $0 !~ /^[[:space:]]*#/)c++} END{print c+0}' "${dir}/context.md")
            if [ "$c" -lt 3 ]; then
                echo "  [context] ${kindDir}/${slug}: context stub (${c} content lines)"; issues=$((issues+1))
            fi
            # context.md frontmatter carries exactly two keys: slug, updated.
            # It was unchecked, which is how a pre-migration `altitude:` field
            # survived in 100k/oneness alone (found 2026-10-09, canon walk).
            while IFS= read -r k; do
                case "$k" in
                    ""|slug|updated) ;;
                    *) echo "  [key]     ${kindDir}/${slug}/context.md: non-standard key '${k}'"; issues=$((issues+1)) ;;
                esac
            done < <(awk 'NR==1 && /^---[[:space:]]*$/{f=1;next} f && /^---[[:space:]]*$/{exit} f && /^[A-Za-z0-9_-]+:/{k=$0;sub(/:.*/,"",k);print k}' "${dir}/context.md")
        fi
        while IFS= read -r p; do
            if [ -z "$p" ]; then continue; fi
            rel="${p#/kingdom/}"; path="${KINGDOM_ROOT}/${rel}"
            if [ ! -f "${path}/goal.md" ] && [ ! -f "${path}/project.md" ]; then
                echo "  [parent]  ${kindDir}/${slug}: dangling parent ${p}"; issues=$((issues+1))
            fi
        done < <(fm_get "$file" parents | tr ' ' '\n' | grep -E '/kingdom/' || true)
        # relates-to is a cross-reference to another CONTAINER. A spec id, a slug
        # or a bare note is a reference, and the 6th amendment sends references
        # to the body. Added 2026-10-09 (canon walk, alice-onboarding).
        while IFS= read -r r; do
            case "$r" in
                ""|'?') continue ;;
                /kingdom/*)
                    # It must also RESOLVE, as parents do. A path with the right
                    # prefix but no container behind it was passing the test
                    # (caught 2026-10-09: kingdom-fs -> /kingdom/.ignore, absent).
                    # Five kinds now, not three — a case legitimately relates to a
                    # component, and this test would have called that a defect.
                    rel="${r#/kingdom/}"; path="${KINGDOM_ROOT}/${rel}"
                    if [ ! -f "${path}/goal.md" ] && [ ! -f "${path}/project.md" ] \
                       && [ ! -f "${path}/component.md" ] && [ ! -f "${path}/case.md" ]; then
                        echo "  [relates] ${kindDir}/${slug}: relates-to does not resolve: ${r}"; issues=$((issues+1))
                    fi
                    ;;
                *) echo "  [relates] ${kindDir}/${slug}: relates-to is not a container path: ${r}"; issues=$((issues+1)) ;;
            esac
        done < <(fm_get "$file" relates-to | tr ' ' '\n' || true)
        if [ "$kindDir" = goals ]; then
            for n in $(sed -n '/^## Projects serving/,/^## /p' "$file" | grep -oE '^- [a-z0-9-]+' | sed 's/^- //' | sort -u); do
                pf="${KINGDOM_ROOT}/projects/${n}/project.md"
                if [ ! -f "$pf" ]; then
                    echo "  [serving] ${kindDir}/${slug}: body names '${n}' -> no such project"; issues=$((issues+1))
                elif ! grep -q "goals/${slug}" "$pf"; then
                    echo "  [serving] ${kindDir}/${slug}: body names '${n}' -> does not parent here"; issues=$((issues+1))
                fi
            done
        fi
    }

    echo -e "${BOLD}Canon check${NC}"
    for dir in "${GOALS_DIR}"/*/; do
        if [ ! -d "$dir" ]; then continue; fi
        _check_one "${dir%/}" "$(basename "${dir%/}")" goals
    done
    for dir in "${PROJECTS_DIR}"/*/; do
        if [ ! -d "$dir" ]; then continue; fi
        _check_one "${dir%/}" "$(basename "${dir%/}")" projects
        for sdir in "${dir}"*/; do
            if [ ! -f "${sdir}project.md" ]; then continue; fi
            _check_one "${sdir%/}" "$(fm_get "${sdir}project.md" slug)" projects
        done
    done
    for dir in "${KINGDOM_ROOT}/100k"/*/; do
        if [ ! -d "$dir" ]; then continue; fi
        _check_one "${dir%/}" "$(basename "${dir%/}")" 100k
    done
    for kindDir in components cases entities contacts; do
        for dir in "${KINGDOM_ROOT}/${kindDir}"/*/; do
            if [ ! -d "$dir" ]; then continue; fi
            # A contact MIRROR is a snapshot of an external repo (origins.txt marks
            # it). Canon lints what it authors, not what it mirrors.
            if [ "$kindDir" = "contacts" ] && [ -f "${dir}origins.txt" ]; then continue; fi
            _check_one "${dir%/}" "$(basename "${dir%/}")" "$kindDir"
        done
    done
    if [ "$issues" -eq 0 ]; then echo -e "  ${GREEN}clean${NC}"; else echo -e "  ${YELLOW}${issues} issue(s)${NC}"; fi
}

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
                for sdir in "${pdir}"/*/; do
                    [ -f "${sdir}project.md" ] || continue
                    local s_sslug=$(fm_get "${sdir}project.md" "slug")
                    local s_sstatus=$(fm_get "${sdir}project.md" "status")
                    local s_shorizon=$(fm_get "${sdir}project.md" "horizon")
                    echo -e "         ↳ ${s_sslug} [${s_sstatus}] (${s_shorizon})"
                done
            fi
        done
    done

    echo ""
    echo -e "${YELLOW}Parented to a project (not to a goal)${NC}"
    echo "------------------------------------"
    # Rule 2 permits a project parent either to a goal or to a parent project.
    # The flat project→project case (parent set, folder top-level) is legal, and
    # calling it "Unlinked" was simply wrong — it is linked, to a project. The
    # parent is named here (2026-10-09, canon walk: five containers sat under a
    # label that read as a defect report).
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
            echo -e "  ${BOLD}${pslug}${NC} [${pstatus}] (${phorizon}) → ${parents:-none}"
        fi
    done
}

cmd_link() {
    [ $# -lt 2 ] && die "Usage: koad-io kingdom link <project> <goal>"
    local project="$1" goal="$2"
    slug_exists "projects" "$project" || die "Project '${project}' not found"
    slug_exists "goals" "$goal" || die "Goal '${goal}' not found"
    fm_add_list "$(dir_of project "$project")/project.md" "parents" "/kingdom/goals/${goal}"
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
    local file="$(dir_of "$([ "$type" = "goals" ] && echo goal || echo project)" "$slug")/${filetype}.md"

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

# --- Standalone commit ---

cmd_commit() {
    [ $# -lt 1 ] && die "Usage: koad-io kingdom commit <slug> [-m <message>]"
    local slug="" message=""
    while [ $# -gt 0 ]; do
        case "$1" in
            -m|--message) message="$2"; shift 2 ;;
            *) slug="$1"; shift ;;
        esac
    done
    [ -z "$slug" ] && die "Usage: koad-io kingdom commit <slug> [-m <message>]"

    local type=""
    slug_exists "goals" "$slug" && type="goal"
    slug_exists "projects" "$slug" && type="project"
    # components and cases gained their verbs 2026-10-09; commit was missed, which
    # forced every component/case commit to be a hand-run git command — the exact
    # path rule 5 exists to prevent. Found live on the echoplex walk, 2026-10-10.
    slug_exists "components" "$slug" && type="component"
    slug_exists "cases" "$slug" && type="case"
    [ -z "$type" ] && die "No container found for '${slug}' (goal, project, component or case)"

    local dir
    dir=$(dir_of "$type" "$slug")
    [ -z "$message" ] && message="update"

    commit_bubble "$type" "$slug" "$message"
}

# --- Contacts helpers ---

contact_exists() {
    local handle="$1"
    [ -d "${CONTACTS_DIR}/${handle}" ] && [ -d "${CONTACTS_DIR}/${handle}/.git" ]
}

contact_get_origin() {
    local handle="$1"
    cd "${CONTACTS_DIR}/${handle}" 2>/dev/null
    git remote get-url origin 2>/dev/null || echo "-"
}

contact_get_forge() {
    local handle="$1"
    cd "${CONTACTS_DIR}/${handle}" 2>/dev/null
    git remote get-url forge 2>/dev/null || echo "-"
}

contact_last_commit() {
    local handle="$1"
    cd "${CONTACTS_DIR}/${handle}" 2>/dev/null
    git log -1 --format='%h %s %ar' 2>/dev/null || echo "-"
}

contact_get_cid() {
    local handle="$1"
    koad-io generate cid "$handle" 2>/dev/null || echo "?"
}

# --- Contacts subcommands ---

cmd_contacts_list() {
    [ ! -d "$CONTACTS_DIR" ] && { echo "No contacts directory"; exit 0; }

    printf "${BOLD}%-20s %-35s %-35s %s${NC}\n" "HANDLE" "ORIGIN" "FORGE" "LAST COMMIT"
    printf "%s\n" "----------------------------------------------------------------------------------------------------"

    for dir in "$CONTACTS_DIR"/*/; do
        [ ! -d "$dir" ] && continue
        local handle=$(basename "$dir")
        # A contact is not required to be a git repo. Two of the five are MIRRORS
        # of external repos (they carry origins.txt and a .git); the rest are
        # AUTHORED canon containers. The old `[ ! -d "${dir}.git" ] && continue`
        # made every authored party invisible to the one command that reads the
        # lane — canada (125 files) and jim-balsillie among them. (koad 2026-10-11.)
        local shape="authored"
        [ -d "${dir}.git" ] && shape="mirror"

        local origin=$(cd "$dir" && git remote get-url origin 2>/dev/null || echo "-")
        local forge=$(cd "$dir" && git remote get-url forge 2>/dev/null || echo "-")
        local last=$(cd "$dir" && git log -1 --format='%h %s %ar' 2>/dev/null || echo "-")

        printf "%-20s %-35s %-35s %s\n" "$handle" "$origin" "$forge" "$last"
    done
}

cmd_contacts_show() {
    [ $# -lt 1 ] && die "Usage: koad-io kingdom contacts show <handle>"
    local handle="$1"
    contact_exists "$handle" || die "Contact '${handle}' not found at ${CONTACTS_DIR}/${handle}"

    local cid=$(contact_get_cid "$handle")
    local origin=$(contact_get_origin "$handle")
    local forge=$(contact_get_forge "$handle")
    local last=$(contact_last_commit "$handle")

    echo -e "${BOLD}=== ${handle} ===${NC}"
    echo ""
    echo -e "${BOLD}Handle:${NC}    ${handle}"
    echo -e "${BOLD}CID:${NC}       ${cid}"
    echo -e "${BOLD}Origin:${NC}    ${origin}"
    echo -e "${BOLD}Forge:${NC}     ${forge}"
    echo -e "${BOLD}Last commit:${NC} ${last}"
    echo ""

    # Show git status
    if cd "${CONTACTS_DIR}/${handle}" 2>/dev/null; then
        local status=$(git status --short 2>/dev/null | head -10)
        if [ -n "$status" ]; then
            echo -e "${YELLOW}Uncommitted changes:${NC}"
            echo "$status"
        else
            echo -e "${GREEN}Working tree clean${NC}"
        fi
        echo ""
        echo -e "Branches:"
        git branch -a 2>/dev/null | head -10
    fi
}

cmd_contacts_add() {
    local url="" org="contacts"
    while [ $# -gt 0 ]; do
        case "$1" in
            --org=*) org="${1#*=}" ;;
            --*) die "Unknown flag: $1" ;;
            *) url="$1" ;;
        esac
        shift
    done
    [ -z "$url" ] && die "Usage: koad-io kingdom contacts add <url> [--org=<org>]"

    # Derive name from url
    local name
    name=$(basename "$url" .git)
    [ -z "$name" ] && die "Could not derive contact name from URL"

    local dir="${CONTACTS_DIR}/${name}"
    [ -d "$dir" ] && die "Contact '${name}' already exists at ${dir}"

    echo -e "→ Cloning ${url} into ${dir}"
    mkdir -p "$dir"
    git clone "$url" "$dir" || die "Clone failed for ${url}"

    echo -e "→ Mirroring to forge (org: ${org})"
    # Mirror via the forge mirror subcommand
    "${COMMAND_DIR}/forge/mirror/command.sh" "$url" --org="$org" --name="$name" || echo -e "${YELLOW}⚠${NC} forge mirror failed — continuing with local clone"

    echo -e "${GREEN}✓${NC} Contact '${name}' added"
    echo -e "  Location: ${dir}"
    echo -e "  Remotes:"
    cd "$dir" 2>/dev/null && git remote -v | while read -r line; do echo "    $line"; done
}

cmd_contacts_sync() {
    [ $# -lt 1 ] && die "Usage: koad-io kingdom contacts sync <handle>"
    local handle="$1"
    contact_exists "$handle" || die "Contact '${handle}' not found"

    local dir="${CONTACTS_DIR}/${handle}"

    echo -e "→ Syncing ${handle}..."

    # Pull from origin
    if cd "$dir" && git remote get-url origin &>/dev/null; then
        echo -e "  ${BOLD}Pull from origin${NC}"
        git pull --ff-only origin 2>&1 | sed 's/^/    /' || echo -e "  ${YELLOW}⚠${NC} pull failed (not ff? network?)"
    else
        echo -e "  ${YELLOW}⚠${NC} no origin remote configured"
    fi

    # Push to forge
    if cd "$dir" && git remote get-url forge &>/dev/null; then
        echo -e "  ${BOLD}Push to forge${NC}"
        git push forge 2>&1 | sed 's/^/    /' || echo -e "  ${YELLOW}⚠${NC} push failed"
    else
        echo -e "  ${YELLOW}⚠${NC} no forge remote configured"
    fi

    echo -e "${GREEN}✓${NC} Sync complete for ${handle}"
}

# --- Packages subcommands ---

cmd_packages_list() {
    [ ! -d "$PACKAGES_DIR" ] && { echo "No packages directory"; exit 0; }

    printf "${BOLD}%-25s %-10s %s${NC}\n" "SLUG" "GIT" "LAST MODIFIED"
    printf "%s\n" "-----------------------------------------------------"

    for dir in "$PACKAGES_DIR"/*/; do
        [ ! -d "$dir" ] && continue
        local slug=$(basename "$dir")
        local git_status="no"
        [ -d "${dir}.git" ] && git_status="yes"
        local mtime
        mtime=$(stat -c '%y' "$dir" 2>/dev/null | cut -d. -f1 || echo "-")

        printf "%-25s %-10s %s\n" "$slug" "$git_status" "$mtime"
    done
}

cmd_packages_clone() {
    [ $# -lt 1 ] && die "Usage: koad-io kingdom packages clone <name> [--from=<path>]"
    local name="" source_dir=""
    for arg in "$@"; do
        if [[ "$arg" =~ ^--from=(.*)$ ]]; then
            source_dir="${BASH_REMATCH[1]}"
        else
            name="$arg"
        fi
    done

    [ -z "$name" ] && die "Usage: koad-io kingdom packages clone <name> [--from=<path>]"

    local target="${PACKAGES_DIR}/${name}"
    [ -d "$target" ] && die "Package '${name}' already exists in overrides at ${target}"

    # Default source is framework packages
    [ -z "$source_dir" ] && source_dir="${FRAMEWORK_PACKAGES_DIR}/${name}"
    [ ! -d "$source_dir" ] && die "Source '${source_dir}' not found — specify --from=<path> to clone from a different location"

    echo -e "→ Cloning ${name} from ${source_dir} → ${target}"
    mkdir -p "$target"
    # Copy all contents except .git — we want a fresh history
    rsync -a --exclude='.git' "${source_dir}/" "$target/"

    cd "$target"
    git init
    git add -A
    git commit -m "feat(packages): clone ${name} from framework" 2>/dev/null || true

    echo -e "${GREEN}✓${NC} Package '${name}' cloned to ${target}"
    echo -e "  Git repo initialized with initial commit"
}

cmd_packages_status() {
    [ $# -lt 1 ] && die "Usage: koad-io kingdom packages status <name>"
    local name="$1"
    local override="${PACKAGES_DIR}/${name}"
    local framework="${FRAMEWORK_PACKAGES_DIR}/${name}"

    [ ! -d "$override" ] && die "Override package '${name}' not found at ${override}"
    [ ! -d "$framework" ] && die "Framework package '${name}' not found at ${framework} — nothing to compare against"

    echo -e "${BOLD}=== ${name}: override vs framework ===${NC}"
    echo ""

    local diff_output
    diff_output=$(diff -rq -x '.git' "$override" "$framework" 2>/dev/null || true)

    if [ -z "$diff_output" ]; then
        echo -e "${GREEN}No differences — override matches framework${NC}"
        return
    fi

    local differs=0 only_override=0 only_framework=0
    while IFS= read -r line; do
        if echo "$line" | grep -q "differ$"; then
            differs=$((differs + 1))
        elif echo "$line" | grep -q "Only in ${override}/"; then
            only_override=$((only_override + 1))
        elif echo "$line" | grep -q "Only in ${framework}/"; then
            only_framework=$((only_framework + 1))
        fi
    done <<< "$diff_output"

    echo -e "${YELLOW}Files that differ:${NC}  ${differs}"
    echo -e "${YELLOW}Files only in override:${NC} ${only_override}"
    echo -e "${YELLOW}Files only in framework:${NC} ${only_framework}"
    echo ""
    echo "$diff_output"
}

cmd_packages_diff() {
    [ $# -lt 1 ] && die "Usage: koad-io kingdom packages diff <name>"
    local name="$1"
    local override="${PACKAGES_DIR}/${name}"
    local framework="${FRAMEWORK_PACKAGES_DIR}/${name}"

    [ ! -d "$override" ] && die "Override package '${name}' not found at ${override}"
    [ ! -d "$framework" ] && die "Framework package '${name}' not found at ${framework} — nothing to diff against"

    diff -ruN -x '.git' "$framework" "$override" 2>/dev/null || true
}

# --- Calendar subcommands ---

calendar_slug() {
    local title="$1"
    echo "$title" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//'
}

calendar_path() {
    local date="$1" slug="$2"
    local year month day
    IFS='-' read -r year month day <<< "$date"
    echo "${CALENDAR_DIR}/${year}/${month}/${day}-${slug}.md"
}

calendar_ensure_dir() {
    local date="$1"
    local year month
    IFS='-' read -r year month _ <<< "$date"
    mkdir -p "${CALENDAR_DIR}/${year}/${month}"
}

calendar_is_date() {
    [[ "$1" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]
}

calendar_is_month() {
    [[ "$1" =~ ^[0-9]{4}-[0-9]{2}$ ]]
}

cmd_calendar_list() {
    local date="" month=""
    for arg in "$@"; do
        case "$arg" in
            --date=*) date="${arg#*=}" ;;
            --month=*) month="${arg#*=}" ;;
        esac
    done

    [ ! -d "$CALENDAR_DIR" ] && { echo "No calendar directory"; exit 0; }

    # Default to today
    if [ -z "$date" ] && [ -z "$month" ]; then
        date=$(date +%Y-%m-%d)
    fi

    if [ -n "$date" ]; then
        calendar_is_date "$date" || die "Invalid date: ${date} (use YYYY-MM-DD)"
        local year month day
        IFS='-' read -r year month day <<< "$date"
        local dir="${CALENDAR_DIR}/${year}/${month}"

        if [ ! -d "$dir" ]; then
            echo "No entries for ${date}"
            exit 0
        fi

        printf "${BOLD}%-30s %-12s %s${NC}\n" "TITLE" "KIND" "TAGS"
        printf "%s\n" "------------------------------------------------------------"

        local any=false
        for f in "$dir/${day}-"*.md; do
            [ ! -f "$f" ] && continue
            any=true
            local title kind tags
            title=$(fm_get "$f" "title")
            kind=$(fm_get "$f" "kind")
            tags=$(fm_get "$f" "tags")
            [ "$kind" = "null" ] && kind="note"
            [ "$tags" = "null" ] && tags="-"
            printf "%-30s %-12s %s\n" "$title" "$kind" "$tags"
        done
        $any || echo "No entries for ${date}"

    elif [ -n "$month" ]; then
        calendar_is_month "$month" || die "Invalid month: ${month} (use YYYY-MM)"
        local year month_num
        IFS='-' read -r year month_num <<< "$month"
        local dir="${CALENDAR_DIR}/${year}/${month_num}"

        [ ! -d "$dir" ] && { echo "No entries for ${month}"; exit 0; }

        printf "${BOLD}%-12s %-30s %-12s %s${NC}\n" "DATE" "TITLE" "KIND" "TAGS"
        printf "%s\n" "------------------------------------------------------------------------------"

        local any=false
        for f in "$dir/"*.md; do
            [ ! -f "$f" ] && continue
            any=true
            local fname title kind tags
            fname=$(basename "$f" .md)
            title=$(fm_get "$f" "title")
            kind=$(fm_get "$f" "kind")
            tags=$(fm_get "$f" "tags")
            [ "$kind" = "null" ] && kind="note"
            [ "$tags" = "null" ] && tags="-"

            local day slug_part
            day=$(echo "$fname" | cut -d- -f1)
            slug_part=$(echo "$fname" | cut -d- -f2-)

            printf "%-12s %-30s %-12s %s\n" "${year}-${month_num}-${day}" "$title" "$kind" "$tags"
        done
        $any || echo "No entries for ${month}"
    fi
}

cmd_calendar_show() {
    local date="" slug=""
    for arg in "$@"; do
        case "$arg" in
            --date=*) date="${arg#*=}" ;;
            *) [ -z "$slug" ] && slug="$arg" ;;
        esac
    done
    [ -z "$slug" ] && die "Usage: koad-io kingdom calendar show <slug> [--date=<ISO>]"
    [ -z "$date" ] && date=$(date +%Y-%m-%d)
    calendar_is_date "$date" || die "Invalid date: ${date}"

    local file; file=$(calendar_path "$date" "$slug")
    [ ! -f "$file" ] && die "Calendar entry '${slug}' not found on ${date}"

    echo -e "${BOLD}=== ${slug} ===${NC}"
    echo ""
    python3 "${COMMAND_DIR}/fm.py" show "$file"
    echo ""
    echo -e "${BOLD}File:${NC} ${file}"
    echo ""
    # Show body (content after frontmatter)
    sed '1,/^---$/d' "$file" | tail -n +3
}

cmd_calendar_pin() {
    local date="" title="" ref="" refs="" tags=""
    local positional=()
    for arg in "$@"; do
        case "$arg" in
            --ref=*)   ref="${arg#*=}" ;;
            --refs=*)  refs="${arg#*=}" ;;
            --tags=*)  tags="${arg#*=}" ;;
            *)         positional+=("$arg") ;;
        esac
    done

    date="${positional[0]:-}"
    title="${positional[1]:-}"

    [ -z "$date" ] && die "Usage: koad-io kingdom calendar pin <date> <title> [--ref=<ref>] [--refs=<list>] [--tags=<list>]"
    [ -z "$title" ] && die "Title is required"
    calendar_is_date "$date" || die "Invalid date: ${date} (use YYYY-MM-DD)"

    local slug; slug=$(calendar_slug "$title")
    calendar_ensure_dir "$date"

    local file; file=$(calendar_path "$date" "$slug")
    [ -f "$file" ] && die "Keyframe '${slug}' already exists on ${date}"

    # Build refs YAML list
    local refs_yaml="[]"
    local refs_list=""
    if [ -n "$refs" ]; then
        refs_list="$refs"
    fi
    if [ -n "$ref" ]; then
        if [ -n "$refs_list" ]; then
            refs_list="${refs_list},${ref}"
        else
            refs_list="$ref"
        fi
    fi
    if [ -n "$refs_list" ]; then
        refs_yaml=""
        IFS=',' read -ra parts <<< "$refs_list"
        for p in "${parts[@]}"; do
            p="$(echo "$p" | xargs)"
            [ -n "$p" ] && refs_yaml="${refs_yaml}  - ${p}\n"
        done
        refs_yaml="$(echo -e "$refs_yaml" | sed 's/\n$//')"
    fi

    # Build tags YAML list
    local tags_yaml="[]"
    if [ -n "$tags" ]; then
        tags_yaml=""
        IFS=',' read -ra parts <<< "$tags"
        for p in "${parts[@]}"; do
            p="$(echo "$p" | xargs)"
            [ -n "$p" ] && tags_yaml="${tags_yaml}  - ${p}\n"
        done
        tags_yaml="$(echo -e "$tags_yaml" | sed 's/\n$//')"
    fi

    cat > "$file" << PINEOF
---
slug: ${slug}
title: ${title}
date: ${date}
kind: keyframe
refs:
${refs_yaml}
tags:
${tags_yaml}
---

${title}

PINEOF

    echo -e "${GREEN}✓${NC} Keyframe '${slug}' pinned for ${date}"
    echo -e "  File: ${file}"
}

# --- Commitment subcommands ---

cmd_commitment_list() {
    local type_filter=""
    for arg in "$@"; do
        case "$arg" in
            --type=*) type_filter="${arg#*=}" ;;
        esac
    done

    [ ! -d "$COMMITMENTS_DIR" ] && { echo "No commitments directory"; exit 0; }

    printf "${BOLD}%-25s %-12s %-10s %s${NC}\n" "SLUG" "TYPE" "AMOUNT" "TITLE"
    printf "%s\n" "----------------------------------------------------------------"

    local any=false
    for f in "$COMMITMENTS_DIR/"*.md; do
        [ ! -f "$f" ] && continue
        any=true
        local slug title type amount
        slug=$(basename "$f" .md)
        title=$(fm_get "$f" "title")
        type=$(fm_get "$f" "type")
        amount=$(fm_get "$f" "amount")
        [ "$amount" = "null" ] || [ "$amount" = "?" ] && amount=""
        [ -z "$amount" ] && amount="-"

        [ -n "$type_filter" ] && [ "$type" != "$type_filter" ] && continue

        local sc=""
        case "$type" in
            expense) sc="${YELLOW}" ;;
            meeting) sc="${CYAN}" ;;
        esac

        printf "${sc}%-25s %-12s %-10s %s${NC}\n" "$slug" "$type" "$amount" "$title"
    done
    $any || echo "No commitments found"
}

cmd_commitment_show() {
    [ $# -lt 1 ] && die "Usage: koad-io kingdom commitment show <slug>"
    local slug="$1"
    local file="${COMMITMENTS_DIR}/${slug}.md"
    [ ! -f "$file" ] && die "Commitment '${slug}' not found"
    echo -e "${BOLD}=== ${slug} ===${NC}"
    echo ""
    python3 "${COMMAND_DIR}/fm.py" show "$file"
}

cmd_commitment_add() {
    local slug="" title="" type="" amount="" currency="CAD" frequency=""
    local tax_flag=false schedule="" day="" time="" timezone="" duration="" participants="" rule=""
    local payer="koad" payee="" method="auto-deduct"

    local positional=()
    for arg in "$@"; do
        case "$arg" in
            --type=*)         type="${arg#*=}" ;;
            --amount=*)       amount="${arg#*=}" ;;
            --currency=*)     currency="${arg#*=}" ;;
            --frequency=*)    frequency="${arg#*=}" ;;
            --tax)            tax_flag=true ;;
            --schedule=*)     schedule="${arg#*=}" ;;
            --day=*)          day="${arg#*=}" ;;
            --time=*)         time="${arg#*=}" ;;
            --timezone=*)     timezone="${arg#*=}" ;;
            --duration=*)     duration="${arg#*=}" ;;
            --participants=*) participants="${arg#*=}" ;;
            --rule=*)         rule="${arg#*=}" ;;
            --payer=*)        payer="${arg#*=}" ;;
            --payee=*)        payee="${arg#*=}" ;;
            --method=*)       method="${arg#*=}" ;;
            *)                positional+=("$arg") ;;
        esac
    done

    slug="${positional[0]:-}"
    title="${positional[1]:-}"

    [ -z "$slug" ] && die "Usage: koad-io kingdom commitment add <slug> <title> [--type=expense|meeting] [--amount=<N>] [--currency=<C>] [--frequency=<Nd>] [--schedule=<...>] [--day=<Monday>] [--time=<HH:MM>] [--timezone=<zone>] [--participants=<list>]"
    [ -z "$title" ] && die "Title is required"

    # Infer type if not specified
    if [ -z "$type" ]; then
        if [ -n "$amount" ]; then
            type="expense"
        elif [ -n "$schedule" ]; then
            type="meeting"
        else
            die "Could not infer commitment type. Specify --type=expense or --type=meeting"
        fi
    fi

    case "$type" in
        expense|meeting) ;;
        *) die "Invalid type: ${type}. Use expense or meeting" ;;
    esac

    local file="${COMMITMENTS_DIR}/${slug}.md"
    [ -f "$file" ] && die "Commitment '${slug}' already exists"

    if [ "$type" = "expense" ]; then
        [ -z "$amount" ] && die "Expense commitments require --amount=<N>"
        [ -z "$payee" ] && payee="$slug"
        local next_due
        next_due=$(date -d "+1 day" +%Y-%m-%d 2>/dev/null || date -v+1d +%Y-%m-%d)

        cat > "$file" << COMMITEOF
---
slug: ${slug}
title: ${title}
type: expense
amount: ${amount}
currency: ${currency}
tax: ${tax_flag}
frequency: ${frequency}
next_due: ${next_due}
payer: ${payer}
payee: ${payee}
method: ${method}
status: active
---

# ${title}

COMMITEOF
    else
        # meeting
        local participants_yaml="[]"
        if [ -n "$participants" ]; then
            participants_yaml="[${participants}]"
        fi

        {
            echo "---"
            echo "slug: ${slug}"
            echo "title: ${title}"
            echo "type: meeting"
            echo "participants: ${participants_yaml}"
            echo "schedule: ${schedule}"
            echo "day: ${day:-null}"
            echo "time: ${time:-null}"
            echo "timezone: ${timezone:-null}"
            echo "duration: ${duration:-null}"
            [ -n "$rule" ] && echo "rule: ${rule}"
            echo "status: active"
            echo "---"
            echo ""
            echo "# ${title}"
            echo ""
        } > "$file"
    fi

    echo -e "${GREEN}✓${NC} Commitment '${slug}' created"
    echo -e "  File: ${file}"
}

cmd_commitment_tick() {
    [ $# -lt 1 ] && die "Usage: koad-io kingdom commitment tick <slug>"
    local slug="$1"
    local file="${COMMITMENTS_DIR}/${slug}.md"
    [ ! -f "$file" ] && die "Commitment '${slug}' not found"

    local type; type=$(fm_get "$file" "type")
    if [ "$type" != "expense" ] && [ "$type" != "null" ]; then
        echo -e "${YELLOW}⚠${NC} '${slug}' is a meeting — schedule is fixed, no tick action needed"
        return
    fi

    local frequency; frequency=$(fm_get "$file" "frequency")
    local next_due; next_due=$(fm_get "$file" "next_due")
    [ -z "$frequency" ] || [ "$frequency" = "null" ] && die "No frequency set for '${slug}'"
    [ -z "$next_due" ] || [ "$next_due" = "null" ] && die "No next_due set for '${slug}'"

    # Advance next_due by frequency days
    local days="${frequency%d}"
    local new_due
    new_due=$(date -d "${next_due}+${days} days" +%Y-%m-%d 2>/dev/null || date -v+${days}d -j -f "%Y-%m-%d" "$next_due" +%Y-%m-%d)

    fm_set "$file" "next_due" "$new_due"
    echo -e "${GREEN}✓${NC} '${slug}' next_due advanced: ${next_due} → ${new_due}"
}

cmd_commitment_cancel() {
    [ $# -lt 1 ] && die "Usage: koad-io kingdom commitment cancel <slug>"
    local slug="$1"
    local file="${COMMITMENTS_DIR}/${slug}.md"
    [ ! -f "$file" ] && die "Commitment '${slug}' not found"
    fm_set "$file" "status" "cancelled"
    echo -e "${GREEN}✓${NC} Commitment '${slug}' cancelled"
}

# --- Field / body edits (every canon kind) ---
# fm.py has always supported arbitrary field edits, but the CLI exposed no surface
# for goal/project fields (success:, tags:, …) or for the body, so those writes had
# to be hand-edited. These wrap the engine so they go through the CLI.
# List fields (tags, success, participants, contributors, parents, relates-to,
# stack, consumed-by, for) use field-add, which appends one item.
#
# These take the SINGULAR kind (goal|project|component|case) — the same noun the
# subcommands use — so `kingdom component field <slug> stack node` works.
_bubble_path() {  # type slug → prints file path, or dies
    local type="${1:-goal}" slug="${2:-}" file dir
    file="$(_kind_file "$type")"
    [ -n "$slug" ] || die "Usage: koad-io kingdom ${type} field <slug> <key> <value>"
    dir="$(dir_of "$type" "$slug")" || die "${type} '${slug}' not found"
    [ -f "${dir}/${file}" ] || die "${type} '${slug}' not found"
    printf '%s' "${dir}/${file}"
}

cmd_bubble_field() {  # type slug key value...
    local type="${1:-goal}" slug="${2:-}" key="${3:-}"
    [ $# -lt 4 ] && die "Usage: koad-io kingdom ${type} field <slug> <key> <value>"
    shift 3
    local path; path=$(_bubble_path "$type" "$slug")
    fm_set "$path" "$key" "$*"
    echo -e "${GREEN}✓${NC} ${type}(${slug}) ${key} = $*"
}

cmd_bubble_field_add() {  # type slug key value...
    local type="${1:-goal}" slug="${2:-}" key="${3:-}"
    [ $# -lt 4 ] && die "Usage: koad-io kingdom ${type} field-add <slug> <key> <value>"
    shift 3
    local path; path=$(_bubble_path "$type" "$slug")
    python3 "${COMMAND_DIR}/fm.py" add-list "$path" "$key" "$*"
    echo -e "${GREEN}✓${NC} ${type}(${slug}) ${key} += $*"
}

cmd_bubble_field_remove() {  # type slug key value...
    local type="${1:-goal}" slug="${2:-}" key="${3:-}"
    [ $# -lt 4 ] && die "Usage: koad-io kingdom ${type} field-remove <slug> <key> <value>"
    shift 3
    local path; path=$(_bubble_path "$type" "$slug")
    python3 "${COMMAND_DIR}/fm.py" remove-list "$path" "$key" "$*"
    echo -e "${GREEN}✓${NC} ${type}(${slug}) ${key} -= $*"
}

cmd_bubble_key_rm() {  # type slug key
    local type="${1:-goal}" slug="${2:-}" key="${3:-}"
    [ $# -lt 3 ] && die "Usage: koad-io kingdom ${type} key-rm <slug> <key>"
    local path; path=$(_bubble_path "$type" "$slug")
    python3 "${COMMAND_DIR}/fm.py" rm "$path" "$key"
    echo -e "${GREEN}✓${NC} ${type}(${slug}) ${key} removed"
}

cmd_bubble_body() {  # type slug  (new body on stdin)
    local type="${1:-goal}" slug="${2:-}"
    [ $# -lt 2 ] && die "Usage: koad-io kingdom ${type} body <slug>  (new body on stdin)"
    local path; path=$(_bubble_path "$type" "$slug")
    [ -t 0 ] && die "Provide new body via stdin"
    # The success line is a CLAIM. Only print it when fm.py actually replaced the
    # body: it refuses a whole file, a container with no frontmatter, and any
    # result that would carry a second block. Printing the tick unconditionally
    # is how this defect stayed invisible - the message was the only signal, and
    # it was wrong.
    if ! python3 "${COMMAND_DIR}/fm.py" body "$path"; then
        die "body NOT replaced - ${type}(${slug}) is unchanged"
    fi
    echo -e "${GREEN}✓${NC} ${type}(${slug}) body replaced"
}

# --- Router ---
main() {
    [ $# -eq 0 ] && { usage; exit 0; }
    local cmd="$1"; shift
    case "$cmd" in
        goal)
            [ $# -eq 0 ] && die "Usage: koad-io kingdom goal <list|show|context|status|create|field|field-add|body>"
            local sub="$1"; shift
            case "$sub" in
                list)      cmd_goal_list "$@" ;;
                show)      cmd_goal_show "$@" ;;
                context)   cmd_goal_context "$@" ;;
                status)    cmd_goal_status "$@" ;;
                create)    cmd_goal_create "$@" ;;
                field)     cmd_bubble_field goal "$@" ;;
                field-add) cmd_bubble_field_add goal "$@" ;;
                field-remove) cmd_bubble_field_remove goal "$@" ;;
                key-rm)    cmd_bubble_key_rm goal "$@" ;;
                body)      cmd_bubble_body goal "$@" ;;
                *)         die "Unknown goal subcommand: ${sub}" ;;
            esac
            ;;
        project)
            [ $# -eq 0 ] && die "Usage: koad-io kingdom project <list|show|context|status|create|field|field-add|body>"
            local sub="$1"; shift
            case "$sub" in
                list)      cmd_project_list "$@" ;;
                show)      cmd_project_show "$@" ;;
                context)   cmd_project_context "$@" ;;
                status)    cmd_project_status "$@" ;;
                create)    cmd_project_create "$@" ;;
                field)     cmd_bubble_field project "$@" ;;
                field-add) cmd_bubble_field_add project "$@" ;;
                field-remove) cmd_bubble_field_remove project "$@" ;;
                key-rm)    cmd_bubble_key_rm project "$@" ;;
                body)      cmd_bubble_body project "$@" ;;
                *)         die "Unknown project subcommand: ${sub}" ;;
            esac
            ;;
        tree)   cmd_tree "$@" ;;
        check)  cmd_check "$@" ;;
        component)
            [ $# -eq 0 ] && die "Usage: koad-io kingdom component <list|show|context|status|create|field|field-add|field-remove|key-rm|body>"
            local sub="$1"; shift
            case "$sub" in
                list)         cmd_side_list component ;;
                show)         cmd_side_show component "$@" ;;
                context)      cmd_side_context component "$@" ;;
                status)       cmd_side_status component "$@" ;;
                create)       cmd_side_create component "$@" ;;
                field)        cmd_bubble_field component "$@" ;;
                field-add)    cmd_bubble_field_add component "$@" ;;
                field-remove) cmd_bubble_field_remove component "$@" ;;
                key-rm)       cmd_bubble_key_rm component "$@" ;;
                body)         cmd_bubble_body component "$@" ;;
                *)            die "Unknown component subcommand: ${sub}" ;;
            esac
            ;;
        "case")
            [ $# -eq 0 ] && die "Usage: koad-io kingdom case <list|show|context|status|create|field|field-add|field-remove|key-rm|body>"
            local sub="$1"; shift
            case "$sub" in
                list)         cmd_side_list case ;;
                show)         cmd_side_show case "$@" ;;
                context)      cmd_side_context case "$@" ;;
                status)       cmd_side_status case "$@" ;;
                create)       cmd_side_create case "$@" ;;
                field)        cmd_bubble_field case "$@" ;;
                field-add)    cmd_bubble_field_add case "$@" ;;
                field-remove) cmd_bubble_field_remove case "$@" ;;
                key-rm)       cmd_bubble_key_rm case "$@" ;;
                body)         cmd_bubble_body case "$@" ;;
                *)            die "Unknown case subcommand: ${sub}" ;;
            esac
            ;;
        link)   cmd_link "$@" ;;
        acl)    cmd_acl "$@" ;;
        commit) cmd_commit "$@" ;;
        contacts)
            [ $# -eq 0 ] && die "Usage: koad-io kingdom contacts <list|show|add|sync>"
            local sub="$1"; shift
            case "$sub" in
                list) cmd_contacts_list "$@" ;;
                show) cmd_contacts_show "$@" ;;
                add)  cmd_contacts_add "$@" ;;
                sync) cmd_contacts_sync "$@" ;;
                *)    die "Unknown contacts subcommand: ${sub}. Try: list, show, add, sync" ;;
            esac
            ;;
        packages)
            [ $# -eq 0 ] && die "Usage: koad-io kingdom packages <list|clone|status|diff>"
            local sub="$1"; shift
            case "$sub" in
                list)   cmd_packages_list "$@" ;;
                clone)  cmd_packages_clone "$@" ;;
                status) cmd_packages_status "$@" ;;
                diff)   cmd_packages_diff "$@" ;;
                *)      die "Unknown packages subcommand: ${sub}. Try: list, clone, status, diff" ;;
            esac
            ;;
        calendar)
            [ $# -eq 0 ] && die "Usage: koad-io kingdom calendar <list|show|pin>"
            local sub="$1"; shift
            case "$sub" in
                list)   cmd_calendar_list "$@" ;;
                show)   cmd_calendar_show "$@" ;;
                pin)    cmd_calendar_pin "$@" ;;
                *)      die "Unknown calendar subcommand: ${sub}. Try: list, show, pin" ;;
            esac
            ;;
        commitment)
            [ $# -eq 0 ] && die "Usage: koad-io kingdom commitment <list|show|add|tick|cancel>"
            local sub="$1"; shift
            case "$sub" in
                list)   cmd_commitment_list "$@" ;;
                show)   cmd_commitment_show "$@" ;;
                add)    cmd_commitment_add "$@" ;;
                tick)   cmd_commitment_tick "$@" ;;
                cancel) cmd_commitment_cancel "$@" ;;
                *)      die "Unknown commitment subcommand: ${sub}. Try: list, show, add, tick, cancel" ;;
            esac
            ;;
        help|--help|-h) usage ;;
        *) die "Unknown: ${cmd}. Try: goal, project, component, case, tree, link, acl, commit, contacts, packages, calendar, commitment, forge" ;;
    esac
}

main "$@"
