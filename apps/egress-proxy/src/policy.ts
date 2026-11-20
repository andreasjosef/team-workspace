// What the sandbox may reach: plain-HTTP reads from the hosts on the
// allowlist (the local registry). Everything else is refused and logged:
// other hosts, other methods (no `npm publish` from a sandbox), and every
// CONNECT tunnel, since the registry needs none.

export type Decision = { allow: true } | { allow: false; why: string };

const READ_METHODS = new Set(['GET', 'HEAD']);

export const parseAllowlist = (raw: string) =>
  new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );

const hostPort = (url: URL) =>
  `${url.hostname.toLowerCase()}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`;

export const decideHttp = (
  method: string,
  rawUrl: string,
  allow: Set<string>
): Decision => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { allow: false, why: 'not an absolute URL' };
  }
  if (url.protocol !== 'http:') return { allow: false, why: 'not http' };
  if (!allow.has(hostPort(url)))
    return { allow: false, why: 'host not allowed' };
  if (!READ_METHODS.has(method.toUpperCase())) {
    return { allow: false, why: `${method} not allowed` };
  }
  return { allow: true };
};

export const decideConnect = (): Decision => ({
  allow: false,
  why: 'tunnels not allowed',
});
