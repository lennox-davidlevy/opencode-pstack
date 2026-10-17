#!/usr/bin/env python3
"""Exercise installed V2 permission decisions; never execute tested actions."""
import argparse
import json
from pathlib import Path
import subprocess


def api(method, path, body):
    result = subprocess.run(['opencode', 'api', method, path, '--data', json.dumps(body)],
                            check=True, capture_output=True, text=True, timeout=30)
    return json.loads(result.stdout)['data'] if result.stdout.strip() else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--agents', nargs='+', default=[
        'poteto', 'poteto-agent', 'poteto-reviewer', 'poteto-investigator'])
    args = parser.parse_args()
    count = 0
    for agent in args.agents:
        writer = agent in ('poteto', 'poteto-agent')
        investigator = agent == 'poteto-investigator'
        session = api('post', '/api/session', {
            'title': f'pstack permission check {agent}', 'agent': agent,
            'location': {'directory': str(Path.cwd())},
        })
        cases = [
            ('skill', 'pstack-poteto-mode', 'allow'),
            ('skill', 'pstack-runtime', 'allow'),
            ('skill', 'effect', 'deny'),
            ('edit', 'example.txt', 'allow' if writer else 'deny'),
            ('execute', '*', 'allow'),
            ('shell', 'git commit -m example', 'deny'),
            ('shell', 'git push origin HEAD', 'deny'),
            ('shell', 'rm -rf example', 'ask' if writer else 'deny'),
            ('shell', 'python3 -c "print(1)"', 'allow' if writer else 'deny'),
            ('pstack_history', '*', 'allow'),
            ('pstack_schedule', '*', 'ask' if agent == 'poteto' else 'deny'),
            ('pstack_worker', '*', 'ask' if agent == 'poteto' else 'deny'),
            ('pstack_worker_review', '*', 'ask' if agent == 'poteto' else 'deny'),
            ('pstack_terminal', '*', 'ask' if writer else 'deny'),
            ('subagent', 'poteto-agent', 'allow' if agent == 'poteto' else 'deny'),
            ('subagent', 'poteto-investigator', 'allow' if agent == 'poteto' else 'deny'),
            ('subagent', 'general', 'deny'),
            ('context7_query-docs', '*', 'allow' if writer or investigator else 'deny'),
            ('example_mcp_search', '*', 'ask' if investigator else 'deny' if agent == 'poteto-reviewer' else 'allow'),
        ]
        for action, resource, expected in cases:
            result = api('post', f"/api/session/{session['id']}/permission", {
                'agent': agent, 'action': action, 'resources': [resource],
            })
            actual = result['effect']
            if actual == 'ask':
                api('post', f"/api/session/{session['id']}/permission/{result['id']}/reply", {'decision': 'reject'})
            if actual != expected:
                raise RuntimeError(f'{agent}: {action} {resource}: expected {expected}, got {actual}')
            count += 1
        print(f'PASS {agent}: {len(cases)} runtime permission checks')
    print(f'PASS {count} decisions; no tested action executed')


if __name__ == '__main__':
    main()
