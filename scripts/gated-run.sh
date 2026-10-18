#!/usr/bin/env bash
# Run one command under the resource gate in docs/integration-test-isolation.md.
# Usage: scripts/gated-run.sh [-m MEM] [-t SECONDS] [-o OUTBYTES] -- command...
# Containment: transient systemd user scope (MemoryMax, no swap, TasksMax), wall-clock
# timeout, output capped while streaming. Receipt: tmpfs delta, leftover owned
# processes, container delta, memory peak. Exit 0 only when command AND gate pass.
set -u
MEM=2G; SECS=300; OUT=65536
while getopts "m:t:o:" o; do case $o in m) MEM=$OPTARG;; t) SECS=$OPTARG;; o) OUT=$OPTARG;; *) exit 2;; esac; done
shift $((OPTIND-1)); [ "${1:-}" = "--" ] && shift
[ $# -gt 0 ] || { echo "no command" >&2; exit 2; }
AUDIT=${GATE_AUDIT_DIR:-/tmp/claude-gate}; mkdir -p "$AUDIT"
RUN=$(date +%s)-$$; LOG="$AUDIT/$RUN.log"; UNIT="gated-$RUN"
inv() { { ls -A /tmp/opencode 2>/dev/null | sed 's|^|/tmp/opencode/|'; ls -A /tmp 2>/dev/null | grep -v '^claude-' | sed 's|^|/tmp/|'; } | sort; }
bytes() { du -s --block-size=1 /tmp/opencode 2>/dev/null | cut -f1; }
ctr() { docker ps -aq --no-trunc 2>/dev/null | sort; }
inv > "$AUDIT/$RUN.paths.before"; ctr > "$AUDIT/$RUN.ctr.before"; B0=$(bytes); B0=${B0:-0}
echo "GATE baseline: tmpfs(/tmp/opencode)=${B0}B paths=$(wc -l <"$AUDIT/$RUN.paths.before") containers=$(wc -l <"$AUDIT/$RUN.ctr.before") limits: mem=$MEM swap=0 tasks=512 wall=${SECS}s out=${OUT}B"
START=$(date +%s)
timeout --kill-after=10 "$SECS" systemd-run --user --scope --quiet --unit="$UNIT" \
  -p MemoryMax="$MEM" -p MemorySwapMax=0 -p TasksMax=512 -- \
  bash -c 'PEAKF=$1; shift; "$@"; rc=$?; cat /sys/fs/cgroup$(grep "^0::" /proc/self/cgroup | cut -d: -f3)/memory.peak > "$PEAKF" 2>/dev/null; exit $rc' _ "$AUDIT/$RUN.peak" "$@" 2>&1 | head -c "$OUT" > "$LOG"
RC=${PIPESTATUS[0]}
# head closes the pipe at the cap; timeout/SIGPIPE kills the scope's command. Make sure.
systemctl --user stop "$UNIT.scope" >/dev/null 2>&1
sleep 2
PEAK=$(cat "$AUDIT/$RUN.peak" 2>/dev/null || echo unavailable)
LEFT=$(systemctl --user list-units --no-legend "$UNIT*" 2>/dev/null | wc -l)
inv > "$AUDIT/$RUN.paths.after"; ctr > "$AUDIT/$RUN.ctr.after"; B1=$(bytes); B1=${B1:-0}
NEWP=$(comm -13 "$AUDIT/$RUN.paths.before" "$AUDIT/$RUN.paths.after")
NEWC=$(comm -13 "$AUDIT/$RUN.ctr.before" "$AUDIT/$RUN.ctr.after" | wc -l)
tail -c 2000 "$LOG"; echo
echo "---- GATE receipt ($(( $(date +%s)-START ))s, cmd exit=$RC) log=$LOG"
echo "tmpfs /tmp/opencode: ${B0}B -> ${B1}B (delta $((B1-B0))B)"
echo "new paths: ${NEWP:-none}"
echo "new containers: $NEWC   leftover scope units: $LEFT   cgroup memory.peak: $PEAK"
GATE=PASS
[ "$LEFT" -eq 0 ] || GATE=FAIL
[ "$NEWC" -eq 0 ] || GATE=FAIL
[ "$((B1-B0))" -le 1048576 ] || GATE=FAIL
[ -z "$NEWP" ] || GATE=FAIL
[ "$PEAK" != unavailable ] || GATE=INCONCLUSIVE
echo "GATE RESULT: $GATE"
[ "$GATE" = PASS ] && exit "$RC" || exit 99
