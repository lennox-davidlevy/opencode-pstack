import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const modelTasks = /** @type {const} */ (['coordination', 'implementation', 'hard', 'investigation', 'review', 'mechanical']);
export const modelRoles = /** @type {const} */ (['poteto', 'poteto-agent', 'poteto-reviewer', 'poteto-investigator']);
/** @typedef {typeof modelTasks[number]} ModelTask */
/** @typedef {typeof modelRoles[number]} ModelRole */
/** @typedef {{providerID:string,id:string,variant:string}} ModelRef */
/** @typedef {{version:1,tasks:Record<ModelTask,string>,defaults:Record<ModelRole,ModelTask>}} ModelPolicy */

/** @param {unknown} value @returns {ModelRef} */
export function parseModelRef(value) {
  const match = typeof value === 'string' && /^([^/#\s]+)\/([^/#\s]+(?:\/[^/#\s]+)*)#([^/#\s]+)$/.exec(value);
  if (!match) throw new Error('Invalid pstack model policy reference; expected provider/model#variant');
  return { providerID: match[1], id: match[2], variant: match[3] };
}

/** @param {unknown} value @param {readonly string[]} keys @param {string} label
 * @returns {Record<string,unknown>}
 */
function fields(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))) {
    throw new Error(`Invalid pstack model policy ${label}; expected exactly ${keys.join(', ')}`);
  }
  return /** @type {Record<string,unknown>} */ (value);
}

/** @param {unknown} value @returns {ModelPolicy} */
export function parseModelPolicy(value) {
  const policy = fields(value, ['version', 'tasks', 'defaults'], 'fields');
  if (policy.version !== 1) throw new Error('Invalid pstack model policy version; expected 1');
  const tasks = fields(policy.tasks, modelTasks, 'tasks');
  for (const task of modelTasks) parseModelRef(tasks[task]);
  const defaults = fields(policy.defaults, modelRoles, 'defaults');
  for (const role of modelRoles) {
    if (!modelTasks.includes(/** @type {ModelTask} */ (defaults[role]))) {
      throw new Error(`Invalid pstack model policy default for ${role}`);
    }
  }
  return /** @type {ModelPolicy} */ ({ version: 1, tasks: { ...tasks }, defaults: { ...defaults } });
}

/** @param {string} root @returns {Promise<ModelPolicy>} */
export async function loadModelPolicy(root) {
  const path = join(root, 'pstack-models.json');
  try { return parseModelPolicy(JSON.parse(await readFile(path, 'utf8'))); }
  catch (error) { throw new Error(`Cannot load pstack model policy at ${path}: ${String(error)}`, { cause: error }); }
}

/** @param {ModelPolicy} policy @param {string} role @param {string} [task] */
export function resolveModel(policy, role, task) {
  if (!modelRoles.includes(/** @type {ModelRole} */ (role))) throw new Error(`Unknown pstack model role: ${role}`);
  const selected = task === undefined ? policy.defaults[/** @type {ModelRole} */ (role)] : task;
  if (!modelTasks.includes(/** @type {ModelTask} */ (selected))) throw new Error(`Unknown pstack model task: ${selected}`);
  return { task: /** @type {ModelTask} */ (selected), model: parseModelRef(policy.tasks[/** @type {ModelTask} */ (selected)]) };
}

/** @param {ModelRef} model
 * @param {readonly {providerID:string,id:string,enabled:boolean,variants:readonly {id:string}[]}[]} inventory
 */
export function assertModelAvailable(model, inventory) {
  const available = inventory.find(candidate => candidate.providerID === model.providerID && candidate.id === model.id);
  if (!available?.enabled || !available.variants.some(variant => variant.id === model.variant)) {
    throw new Error(`Configured pstack worker model ${model.providerID}/${model.id}#${model.variant} is unavailable, disabled, or missing its variant`);
  }
}
