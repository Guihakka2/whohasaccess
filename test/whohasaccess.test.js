import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { apiBase } from '../src/index.js';

const BIN = new URL('../bin/whohasaccess.js', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const ago = (d) => new Date(Date.now() - d * 86400000).toISOString();
const TOKEN = 'ghp_TESTTOKEN123';

// Fake GitHub API: records every request so tests can check method and auth.
const requests = [];
let base;
const routes = {
  '/user/repos': [{ full_name: 'me/app', owner: { login: 'me' } }, { full_name: 'me/site', owner: { login: 'me' } }],
  '/repos/me/app/collaborators': [{ login: 'me', role_name: 'admin' }, { login: 'contractor', role_name: 'admin' }, { login: 'friend', permissions: { push: true } }],
  '/repos/me/app/invitations': [{ invitee: { login: 'old-invite' }, permissions: 'write', created_at: ago(30) }],
  '/repos/me/app/keys': [
    { id: 1, title: 'ci deploy', read_only: false, created_at: ago(400), last_used: ago(200) },
    { id: 2, title: 'backup\x1b[31m', read_only: true, created_at: ago(10), last_used: ago(1) },
  ],
  '/repos/me/app/hooks': [
    { active: true, events: ['push'], config: { url: 'http://hooks.example.com/x?secret=HOOKSECRET', insecure_ssl: '0' }, last_response: { code: 200 } },
    { active: true, events: ['issues'], config: { url: 'https://ok.example.com/h', insecure_ssl: '0' }, last_response: { code: 502 } },
  ],
  '/repos/me/site/collaborators': [], '/repos/me/site/invitations': [], '/repos/me/site/keys': [],
  '/repos/me/site/hooks': 403,
  '/repos/me/site': { full_name: 'me/site', owner: { login: 'me' } },
};
let server;
before(async () => {
  server = createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, auth: req.headers.authorization });
    const path = req.url.split('?')[0];
    if (path === '/user/repos' && !req.url.includes('page=2')) {
      res.writeHead(200, { 'content-type': 'application/json', link: `<${base}/user/repos?per_page=100&page=2>; rel="next", <https://evil.example/steal>; rel="last"` });
      return res.end(JSON.stringify(routes[path].slice(0, 1)));
    }
    if (path === '/user/repos') { res.writeHead(200); return res.end(JSON.stringify(routes[path].slice(1))); }
    const r = routes[path];
    if (r === undefined || r === 403) { res.writeHead(r ?? 404); return res.end('{}'); }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(r));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const run = (args, env = {}) => new Promise((done) => {
  const p = spawn(process.execPath, [BIN, ...args], { env: { ...process.env, NO_COLOR: '1', GH_TOKEN: TOKEN, GITHUB_TOKEN: '', GITHUB_API_URL: base, ...env } });
  let stdout = '', stderr = '';
  p.stdout.on('data', (d) => (stdout += d)); p.stderr.on('data', (d) => (stderr += d));
  p.on('close', (status) => done({ status, stdout, stderr }));
});

test('apiBase requires https except localhost', () => {
  assert.equal(apiBase({}), 'https://api.github.com');
  assert.equal(apiBase({ GITHUB_API_URL: 'https://ghe.corp/api/v3/' }), 'https://ghe.corp/api/v3');
  assert.throws(() => apiBase({ GITHUB_API_URL: 'http://ghe.corp/api/v3' }), /https/);
});

test('audits owned repos: severities, details, no secrets, read-only', async () => {
  requests.length = 0;
  const r = await run([]);
  assert.equal(r.status, 1, r.stderr);
  const out = r.stdout;
  assert.match(out, /2 repositories · 3 high · 3 medium · 1 low/);
  assert.match(out, /HIGH {4}outside collaborator: contractor {2}admin access/);
  assert.match(out, /HIGH {4}deploy key \(WRITE\): ci deploy {2}added 400d ago, last used 200d ago/);
  assert.match(out, /HIGH {4}webhook: hooks\.example\.com {2}push \(not https\)/);
  assert.match(out, /MEDIUM {2}webhook: ok\.example\.com {2}issues \(last delivery 502\)/);
  assert.match(out, /MEDIUM {2}pending invitation: old-invite/);
  assert.match(out, /MEDIUM {2}outside collaborator: friend {2}write access/);
  assert.doesNotMatch(out, /contractor.*\n.*me {2}admin|: me /);
  assert.match(out, /Not checked \(token lacks permission\): me\/site: webhooks/);
  assert.doesNotMatch(out + r.stderr, /HOOKSECRET|TESTTOKEN|\x1b/);
  assert.ok(requests.every((q) => q.method === 'GET'), 'only GET requests');
  assert.ok(requests.every((q) => q.auth === `Bearer ${TOKEN}`));
  assert.ok(requests.some((q) => q.url.includes('page=2')), 'follows same-host pagination');
});

test('--all, --fail-on, --json, single repo, bad input', async () => {
  const all = await run(['--all']);
  assert.match(all.stdout, /LOW {5}deploy key \(read-only\): backup\?\[31m/);
  const clean = await run(['me/site', '--fail-on', 'high']);
  assert.equal(clean.status, 0); assert.match(clean.stdout, /1 repositories · 0 high/);
  const j = JSON.parse((await run(['--json'])).stdout);
  assert.equal(j.ok, false); assert.equal(j.repos, 2); assert.equal(j.findings.filter((f) => f.severity === 'high').length, 3);
  assert.equal((await run(['not-a-repo'])).status, 2);
  assert.equal((await run(['me/missing'])).status, 2);
  assert.equal((await run(['--org', 'bad org'])).status, 2);
  assert.equal((await run([], { GITHUB_API_URL: 'http://evil.example' })).status, 2);
  const typo = await run(['--fail-onn', 'low']);
  assert.equal(typo.status, 2); assert.match(typo.stderr, /did you mean --fail-on/);
});
