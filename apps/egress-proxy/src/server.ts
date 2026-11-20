import http from 'node:http';
import { decideConnect, decideHttp, parseAllowlist } from './policy.ts';

// The sandbox network's only way out. Sits on two networks: `sandbox`
// (internal, no route anywhere) and `egress` (where the registry is).

const PROXY_PORT = Number(process.env.PROXY_PORT ?? 8080);
const ADMIN_PORT = Number(process.env.ADMIN_PORT ?? 8081);
const allow = parseAllowlist(process.env.ALLOW ?? 'verdaccio:4873');

type Denied = { at: number; method: string; target: string; source: string };
const denied: Denied[] = [];
const MAX_DENIED = 1000;

const deny = (method: string, target: string, source: string, why: string) => {
  const entry = { at: Date.now(), method, target, source };
  denied.push(entry);
  if (denied.length > MAX_DENIED) denied.shift();
  console.log(JSON.stringify({ level: 'warn', msg: 'denied', why, ...entry }));
};

const proxy = http.createServer((req, res) => {
  const method = req.method ?? 'GET';
  const target = req.url ?? '';
  const source = req.socket.remoteAddress ?? 'unknown';
  const decision = decideHttp(method, target, allow);
  if (!decision.allow) {
    deny(method, target, source, decision.why);
    res.writeHead(403, { 'content-type': 'text/plain' });
    return res.end(`Blocked by the sandbox egress proxy: ${decision.why}\n`);
  }
  const url = new URL(target);
  const headers = { ...req.headers };
  delete headers['proxy-authorization'];
  delete headers['proxy-connection'];
  const upstream = http.request(
    {
      host: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method,
      headers,
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    }
  );
  upstream.on('error', (err) => {
    res.writeHead(502, { 'content-type': 'text/plain' });
    res.end(`Upstream error: ${err.message}\n`);
  });
  req.pipe(upstream);
});

proxy.on('connect', (req, socket) => {
  const decision = decideConnect();
  if (!decision.allow) {
    deny(
      'CONNECT',
      req.url ?? '',
      req.socket.remoteAddress ?? 'unknown',
      decision.why
    );
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  }
});

// Read-only log for the orchestrator. docker-compose.yml publishes this port
// on the host's loopback only. The sandbox can reach it too, which is fine:
// it only lists refused requests.
const admin = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://admin');
  if (req.method === 'GET' && url.pathname === '/denied') {
    const since = Number(url.searchParams.get('since') ?? 0);
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(denied.filter((d) => d.at >= since)));
  }
  if (url.pathname === '/health') return res.end('ok');
  res.writeHead(404).end();
});

proxy.listen(PROXY_PORT, () =>
  console.log(
    `egress proxy on :${PROXY_PORT}, allowing ${[...allow].join(', ')}`
  )
);
admin.listen(ADMIN_PORT);
