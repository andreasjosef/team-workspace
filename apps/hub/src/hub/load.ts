import { parseDoc, resolveInside } from '@app/agent';
import { Incident, Role, RolePolicy, type ProductDoc } from '@app/shared';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

// The product repo as the hub sees it: role policies and prompts from
// `.hub/`, decisions and docs, and the source files the mock runner ranks.
// This is the hub's own checkout of `main`, which changes only through
// approved patches, so it's trusted. Reads still never follow symlinks.

export type RoleEntry = { policy: RolePolicy; prompt: string };

export type Hub = {
  repoDir: string;
  roles: Map<Role, RoleEntry>;
  docs: ProductDoc[];
  incidents: Incident[];
  sourceFiles: { path: string; content: string }[];
};

const MAX_FILE = 200_000;

const readSafe = async (root: string, rel: string) => {
  const resolved = await resolveInside(root, rel);
  if (!resolved.success) return null;
  const s = await lstat(resolved.value);
  if (!s.isFile() || s.size > MAX_FILE) return null;
  return readFile(resolved.value, 'utf8');
};

const listDir = async (root: string, rel: string) =>
  (await readdir(join(root, rel), { withFileTypes: true }).catch(() => []))
    .filter((e) => e.isFile())
    .map((e) => `${rel}/${e.name}`)
    .sort();

const loadRoles = async (repoDir: string) => {
  const roles = new Map<Role, RoleEntry>();
  for (const name of Role.options) {
    const raw = await readSafe(repoDir, `.hub/roles/${name}.json`);
    if (!raw) throw new Error(`Missing .hub/roles/${name}.json in ${repoDir}`);
    const policy = RolePolicy.parse(JSON.parse(raw));
    if (policy.name !== name)
      throw new Error(`.hub/roles/${name}.json names role ${policy.name}`);
    const prompt = await readSafe(repoDir, `.hub/${policy.systemPrompt}`);
    if (prompt === null)
      throw new Error(`Missing prompt .hub/${policy.systemPrompt}`);
    roles.set(name, { policy, prompt });
  }
  return roles;
};

const loadDocs = async (repoDir: string) => {
  const docs: ProductDoc[] = [];
  for (const dir of ['decisions', 'docs']) {
    for (const path of await listDir(repoDir, dir)) {
      if (!path.endsWith('.md')) continue;
      const raw = await readSafe(repoDir, path);
      if (raw !== null) docs.push(parseDoc(path, raw));
    }
  }
  return docs;
};

const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

const loadSources = async (repoDir: string, rel = 'src') => {
  const out: { path: string; content: string }[] = [];
  const entries = await readdir(join(repoDir, rel), {
    withFileTypes: true,
  }).catch(() => []);
  for (const e of entries) {
    const path = `${rel}/${e.name}`;
    if (e.isDirectory()) out.push(...(await loadSources(repoDir, path)));
    else if (
      e.isFile() &&
      /\.[cm]?[jt]sx?$/.test(e.name) &&
      !TEST_FILE.test(e.name)
    ) {
      const content = await readSafe(repoDir, path);
      if (content !== null) out.push({ path, content });
    }
  }
  return out;
};

export const loadIncidents = async (path: string | undefined) => {
  if (!path) return [];
  return z.array(Incident).parse(JSON.parse(await readFile(path, 'utf8')));
};

export const loadHub = async (
  repoDir: string,
  incidentsFile?: string
): Promise<Hub> => ({
  repoDir,
  roles: await loadRoles(repoDir),
  docs: await loadDocs(repoDir),
  incidents: await loadIncidents(incidentsFile),
  sourceFiles: await loadSources(repoDir),
});

// After a deploy: decisions and sources may have changed. Role policies are
// re-read too, but no agent can have changed them (see refusalFor).
export const reloadHub = async (hub: Hub) => {
  hub.roles = await loadRoles(hub.repoDir);
  hub.docs = await loadDocs(hub.repoDir);
  hub.sourceFiles = await loadSources(hub.repoDir);
};
