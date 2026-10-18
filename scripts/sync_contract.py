#!/usr/bin/env python3
"""Render the shared OpenCode host mapping into imported skill entrypoints."""
import argparse
from pathlib import Path

NATIVE = {'pstack-runtime', 'pstack-setup-pstack'}
START, END = '<!-- opencode-host:start -->', '<!-- opencode-host:end -->'


def render(text, contract):
    if START in text:
        head, rest = text.split(START, 1)
        _, tail = rest.split(END, 1)
        return head + contract + tail
    if not text.startswith('---\n') or '\n---\n' not in text[4:]:
        raise ValueError('missing frontmatter')
    end = text.index('\n---\n', 4) + len('\n---\n')
    return text[:end] + '\n' + contract + '\n' + text[end:]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    contract = (root / 'prompts/pstack-compatibility.md').read_text().rstrip()
    stale = []
    for path in sorted((root / 'skills').glob('pstack-*/SKILL.md')):
        if path.parent.name in NATIVE:
            continue
        text = path.read_text()
        rendered = render(text, contract)
        if rendered != text:
            stale.append(str(path.relative_to(root)))
            if not args.check:
                path.write_text(rendered)
    if args.check and stale:
        raise SystemExit('Run python3 scripts/sync_contract.py. Stale files:\n' + '\n'.join(stale))
    print(f'{len(stale)} skill entrypoints {"stale" if args.check else "updated"}')


if __name__ == '__main__':
    main()
