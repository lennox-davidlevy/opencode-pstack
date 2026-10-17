#!/usr/bin/env python3
"""Read-only CLI prerequisite checks; not a full runtime readiness check."""

import argparse
import json
import re
import subprocess


EXECUTABLES = ("opencode", "node", "git", "python3", "docker")
TIMEOUT_SECONDS = 5


def check(name):
    """Run only --version and return a serializable check result."""
    status = "error"
    try:
        result = subprocess.run(
            [name, "--version"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            errors="replace",
            timeout=TIMEOUT_SECONDS,
            check=False,
        )
        output = " ".join((result.stdout or result.stderr).split())
        if result.returncode != 0:
            detail = "--version exited {}".format(result.returncode)
            if output:
                detail += ": " + output[:200]
        elif not output:
            detail = "--version returned no version output"
        elif name in ("opencode", "node"):
            # Accept bare versions or versions preceded by the executable name.
            match = re.fullmatch(
                r"(?:" + name + r"\s+)?v?(\d+)\.(\d+)\.(\d+)"
                r"([+-][0-9A-Za-z.-]+)?",
                output,
                flags=re.IGNORECASE,
            )
            if not match:
                detail = "unrecognized version output: " + output[:200]
            else:
                version = ".".join(match.group(1, 2, 3)) + (match.group(4) or "")
                supported = (
                    version == "2.0.32" if name == "opencode"
                    else int(match.group(1)) >= 24
                )
                status = "ok" if supported else "unsupported"
                requirement = "exactly 2.0.32" if name == "opencode" else "major >=24"
                detail = "{} (requires {})".format(version, requirement)
        else:
            status = "ok"
            detail = output[:200]
    except FileNotFoundError:
        status = "missing"
        detail = "executable not found on PATH"
    except subprocess.TimeoutExpired:
        detail = "--version timed out after 5 seconds"
    except OSError as exc:
        detail = "cannot execute --version: " + str(exc)[:200]

    if name == "docker":
        detail += "; CLI only; daemon/image not checked"
    return {"name": name, "status": status, "detail": detail}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="emit one JSON object")
    args = parser.parse_args()
    checks = [check(name) for name in EXECUTABLES]
    ok = all(item["status"] == "ok" for item in checks)
    if args.json:
        print(json.dumps({"checks": checks, "ok": ok}))
    else:
        print("CLI prerequisites (not a full runtime readiness check):")
        for item in checks:
            print("{name}: {status} - {detail}".format(**item))
        print("All CLI prerequisites passed." if ok else "CLI prerequisites failed.")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
