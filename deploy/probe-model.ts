// Checks whether an inference model can drive the hub: sends the hub's real
// first prompt for INC-1042 (support role) N times and checks each reply
// parses as the JSON edit format, with a Vitest reproduction.
//
//   node deploy/probe-model.ts <model> [runs] [--dry]
//
// The inference key is read from stdin (first line), never argv or env:
//   fish: read -s -P "Key: " k; printf '%s\n' $k | node deploy/probe-model.ts <model>; set -e k
//   bash: read -rs -p "Key: " k; printf '%s\n' "$k" | node deploy/probe-model.ts <model>; unset k
// Runs on the host against demo/ fixtures only: it reads files and calls the
// inference API, and runs nothing from a task worktree.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadHub } from '../apps/hub/src/hub/load.ts';
import {
  buildTaskMessages,
  createInference,
  matchDecisions,
  parseEditsResponse,
  rankFiles,
} from '../packages/agent/src/index.ts';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const [model, runsArg] = args.filter((a) => a !== '--dry');
if (!model) {
  console.error('usage: node deploy/probe-model.ts <model> [runs] [--dry]');
  process.exit(2);
}
const runs = Number(runsArg) > 0 ? Number(runsArg) : 3;

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const shop = join(repo, 'demo/shop');
const hub = await loadHub(shop, join(repo, 'demo/incidents.json'));
const incident = hub.incidents.find((i) => i.id === 'INC-1042');
const role = hub.roles.get('cs');
if (!incident || !role) throw new Error('INC-1042 or the cs role is missing');

// The same context the pipeline builds for this task.
const task = {
  role: 'cs' as const,
  kind: 'bug' as const,
  title: incident.subject,
  text: incident.body,
  incidentId: incident.id,
};
const text = `${task.title}\n${task.text}`;
const sources = hub.sourceFiles.filter(
  (f) =>
    /^src\/.*\.[cm]?[jt]sx?$/.test(f.path) && !/\.(test|spec)\./.test(f.path)
);
const paths = rankFiles(sources, text);
const decisions = matchDecisions(hub.docs, paths, text);
const messages = buildTaskMessages({
  policy: role.policy,
  rolePrompt: role.prompt,
  task,
  decisions,
  files: paths.map((p) => ({
    path: p,
    content: readFileSync(join(shop, p), 'utf8'),
  })),
  errors: '',
});

console.log(
  `context: files ${paths.join(', ') || '(none)'}; decisions ${decisions.map((d) => d.id).join(', ') || '(none)'}`
);
if (dry) {
  const chars = messages.reduce((n, m) => n + m.content.length, 0);
  console.log(`prompt: ${chars} chars (dry run, nothing sent)`);
  process.exit(0);
}

const apiKey = readFileSync(0, 'utf8').split('\n')[0]?.trim();
if (!apiKey) throw new Error('no inference key on stdin');
const inference = createInference({
  baseUrl:
    process.env.INFERENCE_BASE_URL || 'https://api.vultrinference.com/v1',
  apiKey,
  model,
});

let good = 0;
for (let i = 1; i <= runs; i++) {
  const started = Date.now();
  const reply = await inference.complete(messages);
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (!reply.success) {
    console.log(`run ${i}: FAIL in ${secs}s: ${reply.message}`);
    continue;
  }
  const parsed = parseEditsResponse(reply.value);
  if (!parsed.success) {
    const head = reply.value.slice(0, 160).replace(/\s+/g, ' ');
    console.log(`run ${i}: FAIL in ${secs}s: not the edit format: ${head}`);
    continue;
  }
  const edits = parsed.value.edits;
  const test = edits.find(
    (e) => 'create' in e && /\.(test|spec)\./.test(e.path)
  );
  const vitest =
    test && 'create' in test && /from ['"]vitest['"]/.test(test.create);
  good++;
  console.log(
    `run ${i}: ok in ${secs}s: ${edits.length} edit(s) [${edits.map((e) => e.path).join(', ')}]${test ? (vitest ? ', Vitest test' : ', test NOT Vitest') : ', no new test'}`
  );
}
console.log(`RESULT ${model}: ${good}/${runs} replies in the edit format`);
process.exit(good === runs ? 0 : 1);
