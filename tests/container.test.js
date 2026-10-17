import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { containerOptions, containerCommand, inspectContainer } from '../plugins/pstack/containers.js';
import { makeTempDir } from './helpers/temp.js';
import { ownedContainers } from './helpers/owned-container.js';

// Explicit integration suite: requires the locally built image and Docker.
test('container commands isolate files, credentials and network; read-only roles and stop are enforced',
  { skip: process.env.PSTACK_CONTAINER_TEST !== '1', timeout: 120000 }, async t => {
    const resources = ownedContainers(t);
    const directory = resources.directory(await makeTempDir('pstack-container-test-'));
    const originalEnvironment = process.env;
    process.env = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: directory, DOCKER_CONFIG: `${directory}/.docker` };
    t.after(() => { process.env = originalEnvironment; });
    const options = await containerOptions({});
    await writeFile(`${directory}/input.txt`, 'sandbox input');
    for (const role of ['poteto-agent', 'poteto-reviewer']) {
      const base = { id: randomUUID(), owner: `test-owner-${randomUUID()}`, directory, role };
      const worker = await resources.start(options, base);
      try {
        const read = await containerCommand(worker, 'cat input.txt && test ! -S /var/run/docker.sock && test ! -e /root/.local/share/opencode/opencode.db');
        assert.equal(read.exitCode, 0);
        assert.equal(read.stdout, 'sandbox input');
        const env = await containerCommand(worker, 'env');
        assert.doesNotMatch(env.stdout, /OPENAI|ANTHROPIC|OPENCODE/);
        const network = await containerCommand(worker, `python3 -c 'import socket,errno
try:
 socket.create_connection(("1.1.1.1",443),1)
except OSError as e:
 assert e.errno == errno.ENETUNREACH, repr(e)
 print("NETWORK_ISOLATED")
else:
 raise RuntimeError("Network unexpectedly reachable")'`);
        assert.equal(network.exitCode, 0, network.stderr);
        assert.equal(network.stdout.trim(), 'NETWORK_ISOLATED');
        const edit = await containerCommand(worker, 'printf changed > output.txt');
        assert.equal(edit.exitCode === 0, role === 'poteto-agent');
        if (role === 'poteto-agent') assert.equal(await readFile(`${directory}/output.txt`, 'utf8'), 'changed');
        await assert.rejects(containerCommand({ ...worker, owner: 'other' }, 'true'), /ownership mismatch/);
      } finally {
        assert.equal((await inspectContainer(worker, true)).state, 'exited');
      }
      await assert.rejects(containerCommand(worker, 'true'), /stopped/);
    }
  });

test('owned container cleanup settles in-flight startup and refuses late acquisition',
  { skip: process.env.PSTACK_CONTAINER_TEST !== '1', timeout: 120000 }, async t => {
    let cleanup;
    const resources = ownedContainers({ after: hook => { cleanup = hook; } });
    t.after(() => cleanup());
    const directory = resources.directory(await makeTempDir('pstack-container-cleanup-'));
    const originalEnvironment = process.env;
    process.env = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: directory, DOCKER_CONFIG: `${directory}/.docker` };
    t.after(() => { process.env = originalEnvironment; });
    const options = await containerOptions({});
    const base = { id: randomUUID(), owner: `test-owner-${randomUUID()}`, directory, role: 'poteto-agent' };
    const starting = resources.start(options, base);
    const stopping = cleanup();
    const [worker] = await Promise.all([starting, stopping]);
    await assert.rejects(inspectContainer(worker), /No such (object|container)/i);
    await assert.rejects(resources.start(options, { ...base, id: randomUUID() }), /closing/);
  });
