#!/usr/bin/env python3
"""Owned PTY bridge. JSON requests on stdin, JSON responses on stdout."""
import errno
import fcntl
import json
import os
import select
import signal
import struct
import subprocess
import sys
import termios
import time


def main():
    master, slave = os.openpty()
    os.set_blocking(master, False)
    process = None

    def controlling_terminal():
        os.setsid()
        fcntl.ioctl(0, termios.TIOCSCTTY, 0)

    try:
        for line in sys.stdin:
            request = json.loads(line)
            try:
                action = request['action']
                if action == 'start':
                    if process is not None:
                        raise ValueError('Already started')
                    process = subprocess.Popen(request['argv'], cwd=request['cwd'],
                        stdin=slave, stdout=slave, stderr=slave,
                        preexec_fn=controlling_terminal,
                        env={**os.environ, 'TERM': 'xterm-256color'})
                    os.close(slave)
                    slave = -1
                elif action == 'send':
                    data = request['text'].encode()
                    while data:
                        _, ready, _ = select.select([], [master], [], 2)
                        if not ready:
                            raise TimeoutError('Terminal input blocked')
                        written = os.write(master, data)
                        data = data[written:]
                elif action == 'resize':
                    fcntl.ioctl(master, termios.TIOCSWINSZ,
                        struct.pack('HHHH', request['rows'], request['cols'], 0, 0))
                elif action == 'close':
                    print(json.dumps({'id': request['id'], 'closed': True}), flush=True)
                    break
                elif action != 'read':
                    raise ValueError('Unknown action')
                output = bytearray()
                while len(output) < 65536:
                    readable, _, _ = select.select([master], [], [], 0.05)
                    if not readable:
                        break
                    try:
                        chunk = os.read(master, min(4096, 65536 - len(output)))
                    except OSError as error:
                        if error.errno == errno.EIO:
                            break
                        raise
                    if not chunk:
                        break
                    output.extend(chunk)
                result = {'id': request['id'], 'output': output.decode(errors='replace'),
                    'exitCode': process.poll() if process else None,
                    'truncated': len(output) >= 65536}
            except Exception as error:
                result = {'id': request['id'], 'error': str(error)}
            print(json.dumps(result), flush=True)
    finally:
        if process is not None:
            try:
                os.killpg(process.pid, signal.SIGTERM)
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            except ProcessLookupError:
                pass
            # The group may outlive its leader. Never use leader exit as proof
            # that terminal descendants have stopped.
            deadline = time.monotonic() + 0.2
            while time.monotonic() < deadline:
                try:
                    os.killpg(process.pid, 0)
                except ProcessLookupError:
                    break
                time.sleep(0.01)
            else:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        os.close(master)
        if slave >= 0:
            os.close(slave)


if __name__ == '__main__':
    main()
