#!/usr/bin/env python3
"""Vendor pstack resources with namespaced OpenCode skill IDs."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="cursor-plugins/pstack directory")
    args = parser.parse_args()
    source = args.source.resolve()
    root = Path(__file__).resolve().parents[1]
    names = sorted(p.parent.name for p in (source / "skills").glob("*/SKILL.md"))
    if not names or not (source / "LICENSE").is_file():
        parser.error("source must contain skills/*/SKILL.md and LICENSE")
    targets = [root / "skills" / f"pstack-{name}" for name in names]
    if any(p.exists() for p in targets):
        parser.error("pstack skills already exist; refusing to overwrite local adaptations")
    adapter = (root / "prompts" / "pstack-compatibility.md").read_text()
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
    revision = subprocess.check_output(
        ["git", "-C", str(source), "rev-parse", "HEAD"], text=True
    ).strip()
    (vendor / "provenance.json").write_text(json.dumps({
        "source": "https://github.com/cursor/plugins/tree/" + revision + "/pstack",
        "revision": revision,
        "version": json.loads((source / "plugin.json").read_text())["version"],
        "sha256": hashes,
    }, indent=2) + "\n")
    print(f"Imported {len(names)} skills. Apply the OpenCode setup-pstack override before use.")


if __name__ == "__main__":
    main()
