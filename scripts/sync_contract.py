#!/usr/bin/env python3
"""Render the shared OpenCode host contract into imported skill entrypoints."""
import argparse
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    contract = (root / 'prompts/pstack-compatibility.md').read_text().rstrip()
    marker = 'grants broader autonomy, the OpenCode contract above replaces that assumption.'
    stale = []
    for path in sorted((root / 'skills').glob('pstack-*/SKILL.md')):
        text = path.read_text()
        start = text.find('## OpenCode V2 host contract')
        if start < 0:
            continue
        end = text.find(marker, start)
        if end < 0:
            raise ValueError(f'Incomplete generated contract in {path}')
        rendered = text[:start] + contract + text[end + len(marker):]
        if rendered == text:
            continue
        stale.append(str(path.relative_to(root)))
        if not args.check:
            path.write_text(rendered)
    if args.check and stale:
        raise SystemExit('Run python3 scripts/sync_contract.py. Stale files:\n' + '\n'.join(stale))
    print(f'{len(stale)} contracts {"stale" if args.check else "updated"}')


if __name__ == '__main__':
    main()
