import type { RolePolicy } from '@app/shared';
import { changedLines, type Edit } from './edits.ts';

// Role scopes, enforced on every proposed edit before it reaches a worktree.
// The prompt tells the model its scope; this is what holds it to it. A
// hostile ticket can talk the model into anything, but not past this check.

// `**` crosses directories, `*` stays inside one, everything else is literal.
// `src/auth/**` matches the directory itself and everything below it.
export const globToRegExp = (glob: string): RegExp => {
  const dirAndBelow = glob.endsWith('/**');
  const body = dirAndBelow ? glob.slice(0, -3) : glob;
  let re = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (c === '*' && body[i + 1] === '*') {
      const slash = body[i + 2] === '/';
      re += slash ? '(?:.*/)?' : '.*';
      i += slash ? 2 : 1;
    } else if (c === '*') {
      re += '[^/]*';
    } else {
      re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  if (dirAndBelow) re += '(?:/.*)?';
  return new RegExp(`^${re}$`);
};

const normalise = (path: string) =>
  path.replaceAll('\\', '/').replace(/^\.\//, '');

export type Refusal = { path: string; rule: string };

// Which rule (if any) refuses a write to this path.
export const refusalFor = (policy: RolePolicy, path: string): string | null => {
  const p = normalise(path);
  // Policies themselves are never writable through an agent, whatever the
  // role file says: otherwise a ticket could widen its own scope.
  if (p === '.hub' || p.startsWith('.hub/'))
    return 'role policies are never agent-writable';
  const denied = policy.write.deny.find((g) => globToRegExp(g).test(p));
  if (denied) return `deny ${denied}`;
  if (!policy.write.allow.some((g) => globToRegExp(g).test(p))) {
    return `outside allow (${policy.write.allow.join(', ')})`;
  }
  return null;
};

export type PolicyCheck = { ok: true } | { ok: false; refusals: Refusal[] };

// All or nothing, like applyEdits: one refused path refuses the proposal, and
// every refused path is reported (each becomes a `policy_refused` event).
export const checkPolicy = (policy: RolePolicy, edits: Edit[]): PolicyCheck => {
  const refusals: Refusal[] = [];
  for (const e of edits) {
    const rule = refusalFor(policy, e.path);
    if (rule) refusals.push({ path: e.path, rule });
  }
  const changed = changedLines(edits);
  if (changed > policy.maxChangedLines) {
    refusals.push({
      path: '*',
      rule: `${changed} changed lines, cap ${policy.maxChangedLines}`,
    });
  }
  return refusals.length ? { ok: false, refusals } : { ok: true };
};

// Plain words for the prompt, so the model knows where it may write.
export const describeScope = (policy: RolePolicy) =>
  [
    `You may change files matching: ${policy.write.allow.join(', ')}.`,
    policy.write.deny.length
      ? `You may never change: ${policy.write.deny.join(', ')}, or anything under .hub/.`
      : 'You may never change anything under .hub/.',
    `Keep each proposal under ${policy.maxChangedLines} changed lines.`,
  ].join('\n');
