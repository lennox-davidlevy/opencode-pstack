#!/usr/bin/env python3
"""Vendor pristine upstream pstack skills with namespaced IDs and the OpenCode mapping block."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="cursor-plugins/pstack directory")
    parser.add_argument("--revision", help="upstream commit (default: git rev-parse HEAD in source)")
    args = parser.parse_args()
    source = args.source.resolve()
    root = Path(__file__).resolve().parents[1]
    names = sorted(p.parent.name for p in (source / "skills").glob("*/SKILL.md"))
    if not names or not (source / "LICENSE").is_file():
        parser.error("source must contain skills/*/SKILL.md and LICENSE")
    targets = [root / "skills" / f"pstack-{name}" for name in names]
    for target in targets:
        if target.exists():
            shutil.rmtree(target)
    adapter = (root / "prompts" / "pstack-compatibility.md").read_text().rstrip()
    hashes = {}
    for name, target in zip(names, targets):
        for path in sorted((source / "skills" / name).rglob("*")):
            if not path.is_file() or path.is_symlink():
                continue
            relative = path.relative_to(source / "skills" / name)
            if any(part in {"node_modules", ".git"} for part in relative.parts):
                continue
            data = path.read_bytes()
            hashes[str(path.relative_to(source))] = hashlib.sha256(data).hexdigest()
            if path.suffix == ".md":
                text = data.decode()
                for sibling in names:
                    text = text.replace(f"../{sibling}/", f"../pstack-{sibling}/")
                if relative == Path("SKILL.md"):
                    if not text.startswith("---\n") or "\n---\n" not in text[4:]:
                        raise ValueError(f"Missing frontmatter: {path}")
                    end = text.index("\n---\n", 4) + len("\n---\n")
                    text = text[:end] + "\n" + adapter + "\n" + text[end:]
                data = text.encode()
            destination = target / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
            destination.chmod(path.stat().st_mode & 0o777)
    vendor = root / "vendor" / "pstack"
    vendor.mkdir(parents=True, exist_ok=True)
    (vendor / "LICENSE").write_bytes((source / "LICENSE").read_bytes())
    revision = args.revision or subprocess.check_output(
        ["git", "-C", str(source), "rev-parse", "HEAD"], text=True
    ).strip()
    (vendor / "provenance.json").write_text(json.dumps({
        "source": "https://github.com/cursor/plugins/tree/" + revision + "/pstack",
        "revision": revision,
        "version": json.loads((source / "plugin.json").read_text())["version"],
        "sha256": hashes,
    }, indent=2) + "\n")
    print(f"Imported {len(names)} skills. Re-apply the pstack-setup-pstack and pstack-runtime overrides if they changed.")


if __name__ == "__main__":
    main()
