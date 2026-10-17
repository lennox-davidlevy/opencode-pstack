#!/usr/bin/env python3
"""Exercise isolated V2 permission decisions; never execute tested actions."""
import argparse
import os
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--agents', nargs='+', default=[
        'poteto', 'poteto-agent', 'poteto-reviewer', 'poteto-investigator'])
    args = parser.parse_args()
    implementation = Path(__file__).resolve().with_suffix('.mjs')
    os.execvp('node', ['node', str(implementation), '--agents', *args.agents])


if __name__ == '__main__':
    main()
