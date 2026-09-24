# status-check.sh — monitor mode for `koad-io status` (--check)
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Sourced by ~/.koad-io/bin/status when --check is passed. It compares the
# current probe sweep against a last-known-state *ledger* and reports — and
# optionally alerts on — **changes only**: up→down, down→up, degraded,
# TLS-cert threshold crossings (website properties and electrum alike), and
# registry additions/removals.
#
# A sweep where nothing changed is silent by design. "All 48 fine" on every
# run is noise; the first thing anyone does is mute the channel, and then the
# real alert is muted with it. This monitor exists to speak *only when the
# kingdom changed.* (Probe the registry — never walk ~/.forge/websites/.)
#
# Reads from the sourcing shell (all set by bin/status):
#   $rec                 the sweep record (the same JSON `status --json` prints)
#   $alive $dead         sweep counts
#   $LEDGER_FILE         ledger path (default: ~/.local/share/koad-io/services/health-ledger.json)
#   $CERT_WARN_DAYS      cert warn threshold, days (default 30)
#   $CERT_CRIT_DAYS      cert crit threshold, days (default 14)
#   $RESET_LEDGER        if set, ignore any existing ledger (treat as first run)
#   $NOALERT             if set, never fire alerts / write message files
#   $JSON                if set, print the machine record instead of the human report
#   $D $B $GREEN $Y $RED $R   colour vars (from bin/status)
#
# Result: sets $_CHECK_EXIT — 0 all green, 1 some non-green, 2 all down.
#
# Scheduled invocation (cron, installed 2026-09-24 by vulcan):
#   7 * * * * cd /home/koad && PATH=/usr/local/bin:/usr/bin:/bin HOME=/home/koad \
#     KOAD_IO_EMIT=1 /home/koad/.koad-io/bin/status --check --timeout=5 \
#     >> /home/koad/.local/share/koad-io/sensors/status-check.out 2>&1

koad_status_check_run() {
  local lf="${LEDGER_FILE:-$HOME/.local/share/koad-io/services/health-ledger.json}"
  local warn="${CERT_WARN_DAYS:-30}"
  local crit="${CERT_CRIT_DAYS:-14}"
  local now tmp prev_targets prev_json first_run
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  # ── load ledger (last-known state) ──
  prev_targets='{}'
  first_run=1
  if [ -z "${RESET_LEDGER:-}" ] && [ -f "$lf" ]; then
    if prev_json=$(jq -c '.targets // {}' "$lf" 2>/dev/null) && [ -n "$prev_json" ]; then
      prev_targets="$prev_json"
      first_run=0
    fi
  fi

  tmp=$(mktemp -d 2>/dev/null) || { _CHECK_EXIT=1; return 0; }

  # ── current target states → JSONL ──
  printf '%s' "$rec" | jq -c '.targets[] | {
      key:((.source // "") + "::" + (.label // "")),
      label:(.label // ""),
      source:(.source // ""),
      type:(.type // ""),
      host_port:(.host_port // null),
      state:(if (.alive==true) then (if (.degraded==true) then "degraded" else "up" end) else "down" end),
      status:(.status // 0),
      error:(.error // null),
      reason:(.degraded_reason // null),
      cert_days:(.cert_days_left // null)
    }' > "$tmp/cur.jsonl" 2>/dev/null || : > "$tmp/cur.jsonl"

  # ── diff vs ledger, build changes + new ledger ──
  jq -n --slurpfile cur "$tmp/cur.jsonl" --argjson prev "$prev_targets" \
        --arg now "$now" --argjson warn "$warn" --argjson crit "$crit" '
    def cs($d): if ($d==null) then null elif ($d < $crit) then "crit" elif ($d < $warn) then "warn" else "ok" end;
    ([ $cur[] | . + {cert_state: cs(.cert_days)} ]) as $N |
    ($prev // {}) as $P |
    ([ $N[] as $n | ($P[$n.key]) as $p |
       if $p == null then
         {key:$n.key,label:$n.label,type:"new",level:"notice",state:$n.state,
          msg:("new registry entry ("+$n.type+")")}
       elif ($p.state != $n.state) then
         {key:$n.key,label:$n.label,type:"state",state:$n.state,
          level:(if $n.state=="down" then "error" elif $n.state=="degraded" then "warning" else "notice" end),
          msg:(if $n.state=="down" then ("DOWN (was "+$p.state+")"+(if $n.error!=null then ": "+$n.error else "" end))
               elif $n.state=="degraded" then ("degraded (was "+$p.state+")"+(if $n.reason!=null then ": "+$n.reason else "" end))
               elif $p.state=="down" then "recovered (was down)"
               else ("recovered (was "+$p.state+")") end)}
       else empty end ]
     + [ $N[] as $n | ($P[$n.key]) as $p |
         if ($p!=null and ($p.state==$n.state) and $n.cert_state!=null and $p.cert_state!=null and $p.cert_state!=$n.cert_state) then
           {key:$n.key,label:$n.label,type:"cert",state:$n.state,
            level:(if $n.cert_state=="crit" then "error" elif $n.cert_state=="warn" then "warning" else "notice" end),
            msg:("TLS cert "+$n.cert_state+" ("+($n.cert_days|tostring)+"d, was "+$p.cert_state+")")}
         else empty end ]
     + [ ($P | keys[]) as $k | select(([$N[].key] | index($k)) == null) |
         {key:$k,label:($P[$k].label//$k),type:"removed",level:"notice",state:"gone",
          msg:"removed from registry"} ]
    ) as $changes |
    { updated:$now, total:($N|length), first_run:($P|length==0),
      changes:$changes,
      green_count:([$N[]|select(.state=="up")]|length),
      down_count:([$N[]|select(.state=="down")]|length),
      degraded_count:([$N[]|select(.state=="degraded")]|length),
      not_green:[$N[]|select(.state!="up")|{label:.label,state:.state,detail:.error,reason:.reason}],
      targets:(reduce $N[] as $n ({}; .[$n.key] = {
        label:$n.label,source:$n.source,type:$n.type,state:$n.state,
        cert_days:$n.cert_days,cert_state:$n.cert_state,status:$n.status,
        last_checked:$now,
        since:(if ($P[$n.key]!=null and $P[$n.key].state==$n.state) then ($P[$n.key].since//$now) else $now end)}))
    }' > "$tmp/result.json" 2>/dev/null || printf '{"updated":"%s","total":0,"first_run":true,"changes":[],"green_count":0,"down_count":0,"degraded_count":0,"not_green":[],"targets":{}}\n' "$now" > "$tmp/result.json"

  # ── persist ledger (atomic) ──
  mkdir -p "$(dirname "$lf")"
  if jq -c '{version:1, updated:.updated, targets:.targets}' "$tmp/result.json" > "$tmp/ledger.new" 2>/dev/null; then
    mv "$tmp/ledger.new" "$lf"
  fi

  # ── exit code ──
  local total down deg
  total=$(jq -r '.total' "$tmp/result.json")
  down=$(jq -r '.down_count' "$tmp/result.json")
  deg=$(jq -r '.degraded_count' "$tmp/result.json")
  if [ "$down" -eq 0 ] && [ "$deg" -eq 0 ]; then _CHECK_EXIT=0
  elif [ "$total" -gt 0 ] && [ "$down" -ge "$total" ]; then _CHECK_EXIT=2
  else _CHECK_EXIT=1; fi

  # ── render ──
  if [ -n "${JSON:-}" ]; then
    cat "$tmp/result.json"; echo
  else
    koad_status_check_render "$tmp/result.json"
  fi

  # ── alert ──
  if [ -z "${NOALERT:-}" ]; then
    koad_status_check_alert "$tmp/result.json"
  fi

  rm -rf "$tmp" 2>/dev/null || true
  return 0
}

koad_status_check_render() {
  local r="$1"
  local total green down deg first changes_n
  total=$(jq -r '.total' "$r"); green=$(jq -r '.green_count' "$r")
  down=$(jq -r '.down_count' "$r"); deg=$(jq -r '.degraded_count' "$r")
  first=$(jq -r '.first_run' "$r"); changes_n=$(jq -r '.changes|length' "$r")

  printf '%s── koad:io status --check (%s targets)%s\n' "$D" "$total" "$R"
  if [ "$changes_n" -eq 0 ]; then
    if [ "$first" = "true" ]; then
      printf '  %s✓%s baseline recorded: %sall %s/%s green%s\n' "$GREEN" "$R" "$GREEN" "$green" "$total" "$R"
    else
      printf '  %s✓%s all %s/%s green — no change%s\n' "$GREEN" "$R" "$green" "$total" "$R"
    fi
    return 0
  fi

  jq -r '.changes[] | [.level,.label,.msg] | @tsv' "$r" | while IFS=$'\t' read -r lvl label msg; do
    case "$lvl" in
      error)   sym="${RED}✗${R}" ;;
      warning) sym="${Y}▲${R}" ;;
      *)       sym="${GREEN}•${R}" ;;
    esac
    printf '  %s %s%s%s  %s%s%s\n' "$sym" "$B" "$label" "$R" "$D" "$msg" "$R"
  done
  printf '  %s%s change(s) — %s green, %s down, %s degraded%s\n' "$Y" "$changes_n" "$green" "$down" "$deg" "$R"
}

koad_status_check_alert() {
  local r="$1"
  local first changes_n down deg green total level body
  first=$(jq -r '.first_run' "$r")
  changes_n=$(jq -r '.changes|length' "$r")
  down=$(jq -r '.down_count' "$r"); deg=$(jq -r '.degraded_count' "$r")
  green=$(jq -r '.green_count' "$r"); total=$(jq -r '.total' "$r")

  if [ "$first" = "true" ]; then
    if [ "$down" -eq 0 ] && [ "$deg" -eq 0 ]; then
      level="notice"; body="koad status-check baseline established: ${green}/${total} green"
    else
      level="error"
      [ "$down" -eq 0 ] && level="warning"
      body="koad status-check baseline: ${green}/${total} green — not-green: $(jq -r '[.not_green[]|(.label+" ("+.state+"\(if .reason then ": "+.reason else "" end)")]|join(", ")' "$r")"
    fi
  else
    [ "$changes_n" -eq 0 ] && return 0
    if [ "$down" -gt 0 ]; then level="error"
    elif [ "$deg" -gt 0 ]; then level="warning"
    else level="notice"; fi
    body="koad status-check: ${changes_n} change(s) — $(jq -r '[.changes[]|(.label+": "+.msg)]|join("; ")' "$r")"
  fi

  # Alert path 1 — emission on the kingdom nervous system (existing path).
  # emit.py no-ops silently when the daemon is unreachable.
  if [ -f "$HOME/.koad-io/helpers/emit.sh" ]; then
    (
      KOAD_IO_EMIT="${KOAD_IO_EMIT:-1}"
      # shellcheck disable=SC1090
      . "$HOME/.koad-io/helpers/emit.sh" 2>/dev/null || exit 0
      koad_io_emit_sync "$level" "$body" 2>/dev/null || true
    ) || true
  fi

  # Alert path 2 — message file to koad's inbox (canonical format, mirroring
  # ~/.forge/commands/message). Written directly so the monitor has no
  # dependency on the koad-io launcher (cron runs with a bare environment).
  local from=vulcan to=koad ts iso slug dir file
  ts=$(date -u +"%Y%m%dT%H%M%SZ"); iso=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  slug=$(printf '%s' "$body" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9][^a-z0-9]*/-/g' | cut -c1-48 | sed 's/^-\+//; s/-\+$//')
  [ -z "$slug" ] && slug="status-check"
  dir="$HOME/.forge/messages/$to"
  mkdir -p "$dir" 2>/dev/null || return 0
  file="$dir/${ts}-${from}-${slug}.md"
  {
    printf -- '---\nfrom: %s\nto: %s\ntype: alert\ntimestamp: %s\n---\n\n' "$from" "$to" "$iso"
    printf '%s\n' "$body"
    # On a first run the ledger is empty, so every target reads as "new" —
    # do not enumerate 48 baseline bullets. Detail only matters for a diff.
    if [ "$first" != "true" ]; then
      printf '\n---\n'
      jq -r '.changes[]? | "- \(.level): \(.label) — \(.msg)"' "$r" 2>/dev/null || true
    fi
  } > "$file" 2>/dev/null || true
}
