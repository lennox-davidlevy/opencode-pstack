import { Plugin } from '@opencode/plugin';
import { containerCommand } from '../../plugins/pstack/containers.js';

export default Plugin.define({
  id: 'pstack.container-worker',
  async setup(ctx) {
    const worker = /** @type {any} */ (ctx.options.worker);
    if (!worker?.id) throw new Error('Missing owned worker');
    await ctx.tool.transform(editor => {
      for (const tool of editor.list()) editor.remove(tool.id);
      editor.add({
        name: 'container_command',
        options: { codemode: false },
        description: 'Run a shell command inside your isolated, offline container at /workspace. Use cat/find/grep to inspect, and Python or shell to edit files and run checks. No host access. Commands have a 60 second limit.',
        input: { type: 'object', properties: { command: { type: 'string', minLength: 1, maxLength: 16000 } }, required: ['command'], additionalProperties: false },
        execute: async (input, context) => {
          const session = await ctx.session.get({ sessionID: context.sessionID });
          if (session.metadata?.pstackWorker !== worker.id) throw new Error('Container belongs to another session');
          const { command } = /** @type {{command:string}} */ (input);
          // Shell scripts cannot be authorized as one executable prefix. Keep
          // ambiguous syntax behind a separate approval, even if shell allows it.
          if (!/^[a-zA-Z0-9_./:=,@%+ -]+$/.test(command)) {
            await ctx.permission.assert({ sessionID: context.sessionID, agent: context.agent,
              action: 'pstack_container_script', resources: [command], save: [] });
          }
          const owner = await ctx.session.get({ sessionID: worker.owner });
          await ctx.permission.assert({ sessionID: owner.id, agent: owner.agent,
            action: 'shell', resources: [command], save: [] });
          await ctx.permission.assert({ sessionID: context.sessionID, agent: context.agent,
            source: { type: 'tool', messageID: context.messageID, id: context.id },
            action: 'shell', resources: [command], save: [] });
          return { content: JSON.stringify(await containerCommand(worker, command, context.signal)) };
        },
      });
    });
    // Also constrain the final request snapshot, after other tool registrations.
    await ctx.session.hook('context', event => {
      if (!event.tools.container_command) throw new Error(`Container tool unavailable; registered request tools: ${Object.keys(event.tools).join(', ')}`);
      for (const name of Object.keys(event.tools)) if (name !== 'container_command') delete event.tools[name];
    });
  },
});
