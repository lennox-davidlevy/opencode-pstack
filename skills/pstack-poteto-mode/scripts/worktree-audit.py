#!/usr/bin/env python3
"""Read-only local Git inventory. Activity is unknown, never safe to delete."""

import argparse
import json
import os
import subprocess
import sys
import time


def git(repo, *args):
    # Suppress index refresh, configured filesystem monitors, and lazy fetching.
    env = dict(os.environ, GIT_OPTIONAL_LOCKS="0", GIT_NO_LAZY_FETCH="1",
               GIT_TERMINAL_PROMPT="0", GIT_ALLOW_PROTOCOL="")
    return subprocess.run(
        ["git", "--no-optional-locks", "-c", "core.fsmonitor=false", "-C", repo, *args],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env,
    )


def dirty_state(repo):
    status = git(repo, "status", "--porcelain=v1", "-z", "--untracked-files=all",
                 "--ignored", "--ignore-submodules=none")
    if status.returncode:
        return "unknown"
    counts = {"wip": 0, "untracked": 0, "ignored": 0}
    records = iter(status.stdout.split(b"\0"))
    for record in records:
        if not record:
            continue
        code = record[:2]
        kind = {b"??": "untracked", b"!!": "ignored"}.get(code, "wip")
        counts[kind] += 1
        if b"R" in code or b"C" in code:
            next(records, None)
    return ",".join(f"{kind}:{count}" for kind, count in counts.items() if count) or "clean"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("-b", "--base", help="existing local ref for ancestry only; never fetched")
    parser.add_argument("repo", nargs="?", default=".")
    args = parser.parse_args()
    inventory = git(args.repo, "worktree", "list", "--porcelain", "-z")
    if inventory.returncode:
        parser.exit(1, "error: cannot list local Git worktrees\n")

    base = args.base
    if base is None:
        for candidate in ("origin/HEAD", "origin/main", "origin/master"):
            if git(args.repo, "rev-parse", "--verify", "--quiet", "--end-of-options",
                   candidate + "^{commit}").returncode == 0:
                base = candidate
                break
    base_oid = None
    if base:
        resolved = git(args.repo, "rev-parse", "--verify", "--quiet", "--end-of-options",
                       base + "^{commit}")
        if resolved.returncode:
            parser.exit(1, "error: base ref unavailable locally; no fetch attempted\n")
        base_oid = os.fsdecode(resolved.stdout).strip()

    print("# base: " + json.dumps(base))
    print("# Local snapshot only, including main worktree. Remote refs may be stale.")
    print("# SIZE not measured. AGE is commit age, not activity. PR/REMOTE/LAST_CHAT unknown.")
    print("# Every row requires review and live session/owning worker checks; no deletion approval.")
    print("# Standalone container clones are not listed. Control-character paths are JSON quoted.")
    print("SIZE\tAGE\tMERGED\tDIRTY\tREMOTE\tPR\tLAST_CHAT\tBUCKET\tWORKTREE")
    for record in inventory.stdout.split(b"\0\0"):
        fields = {}
        for field in record.split(b"\0"):
            key, _, value = field.partition(b" ")
            fields[key] = value
        if b"worktree" not in fields:
            continue
        path = os.fsdecode(fields[b"worktree"])
        head = os.fsdecode(fields.get(b"HEAD", b""))
        merged, age, dirty = "unknown", "?", "unknown"
        top = git(path, "rev-parse", "--show-toplevel")
        top_path = os.fsdecode(top.stdout).removesuffix("\n")
        if top.returncode == 0 and os.path.realpath(top_path) == os.path.realpath(path):
            dirty = dirty_state(path)
        if head and set(head) != {"0"}:
            timestamp = git(args.repo, "show", "--no-show-signature", "-s", "--format=%ct", head, "--")
            if timestamp.returncode == 0 and timestamp.stdout.strip().isdigit():
                age = f"{int((time.time() - int(timestamp.stdout)) // 86400)}d"
            if base_oid:
                ancestry = git(args.repo, "merge-base", "--is-ancestor", head, base_oid)
                merged = {0: "YES", 1: "no"}.get(ancestry.returncode, "unknown")
        needs_quoting = any(ord(c) < 32 or ord(c) == 127 for c in path)
        display_path = json.dumps(path) if needs_quoting else path
        print("\t".join(("?", age, merged, dirty, "unknown", "unknown", "unknown",
                         "review-required", display_path)))


if __name__ == "__main__":
    try:
        main()
    except OSError as error:
        sys.exit(f"error: local inventory failed: {error}")
