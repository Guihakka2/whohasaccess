#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { apiBase, client, auditRepo, auditOrg, printable, SEVERITY } from '../src/index.js';

const HELP = `Usage: whohasaccess [owner/repo ...] [options]
       whohasaccess                 (every repository you own)
       whohasaccess --org NAME      (an organization and its repositories)

Read-only audit of who and what can access your GitHub repositories: outside
collaborators, pending invitations, deploy keys (write keys, unused keys),
webhooks (non-https, failing) and, for orgs, members without 2FA and installed apps.
Only GET requests. The token comes from GH_TOKEN, GITHUB_TOKEN or "gh auth token"
and is never printed.

Options:
  --org NAME      Audit an organization
  --all           Also show low-severity items (full inventory)
  --fail-on L     Exit 1 at this severity or above: high (default), medium, low
  --stale DAYS    Deploy keys unused for this long are flagged (default 90)
  --json          Machine-readable output
  -h, --help      Show help
  -v, --version   Show version

Exit codes: 0 = nothing at --fail-on level, 1 = findings, 2 = usage, auth or API error`;

const OPTIONS = { org: { type: 'string' }, all: { type: 'boolean' }, 'fail-on': { type: 'string' }, stale: { type: 'string' },
  json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' } };
const die = (msg) => { process.stderr.write(`whohasaccess: ${printable(msg)}\n`); process.exit(2); };

let args;
try { args = parseArgs({ allowPositionals: true, options: OPTIONS }); } catch (e) {
  const bad = /'(--?[\w-]+)'/.exec(e.message)?.[1];
  const near = bad && Object.keys(OPTIONS).find((k) => bad.length > 3 && `--${k}`.startsWith(bad.slice(0, 4)));
  die(`${bad ? `unknown option ${bad}` : e.message}${near ? ` (did you mean --${near}?)` : ''}. See --help.`);
}
const { values: o, positionals } = args;
if (o.help) { console.log(HELP); process.exit(0); }
if (o.version) { console.log(JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version); process.exit(0); }
const failOn = SEVERITY[(o['fail-on'] ?? 'high').toLowerCase()] ?? die('--fail-on must be high, medium or low');
const staleDays = o.stale === undefined ? 90 : Number(o.stale);
if (!Number.isInteger(staleDays) || staleDays < 1) die('--stale needs a whole number of days');
const NAME = /^[A-Za-z0-9-]{1,39}$/, REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
if (o.org && !NAME.test(o.org)) die(`invalid organization name "${o.org}"`);
for (const p of positionals) if (!REPO.test(p)) die(`"${p}" is not owner/repo`);

let base;
try { base = apiBase(); } catch (e) { die(e.message); }
let token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!token) {
  const r = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8', timeout: 10000 });
  token = r.status === 0 ? r.stdout.trim() : '';
}
if (!token) die('no token: set GH_TOKEN, or install the GitHub CLI and run "gh auth login"');
const api = client({ base, token });

const result = { findings: [], skipped: {}, repos: 0 };
try {
  let repos;
  if (positionals.length) repos = (await Promise.all(positionals.map((p) => api.get(`/repos/${p}`)))).map((r, i) => r.denied ? die(`cannot see ${positionals[i]}`) : r.data);
  else {
    if (o.org) {
      const org = await auditOrg(api, o.org);
      result.findings.push(...org.findings);
      if (org.skipped.length) result.skipped[`org:${o.org}`] = org.skipped;
    }
    const r = await api.list(o.org ? `/orgs/${o.org}/repos?type=all` : '/user/repos?affiliation=owner');
    if (r.denied) die(o.org ? `cannot list repositories of ${o.org}` : 'cannot list your repositories');
    repos = r.items;
  }
  result.repos = repos.length;
  for (let i = 0; i < repos.length; i += 4) {
    for (const a of await Promise.all(repos.slice(i, i + 4).map((repo) => auditRepo(api, repo, { staleDays }).then((x) => ({ repo, ...x }))))) {
      result.findings.push(...a.findings);
      if (a.skipped.length) result.skipped[a.repo.full_name] = a.skipped;
    }
  }
} catch (e) { die(e.cause?.code ?? e.message); }

const rank = (f) => SEVERITY[f.severity];
result.findings.sort((a, b) => rank(b) - rank(a) || a.repo.localeCompare(b.repo));
const failed = result.findings.some((f) => rank(f) >= failOn);
const count = (s) => result.findings.filter((f) => f.severity === s).length;

if (o.json) console.log(JSON.stringify({ ok: !failed, ...result }, null, 2));
else {
  const color = (process.stdout.isTTY || !!process.env.FORCE_COLOR) && !process.env.NO_COLOR;
  const c = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  const COL = { high: 31, medium: 33, low: 2 };
  const shown = result.findings.filter((f) => o.all || f.severity !== 'low');
  console.log(`${c(1, 'whohasaccess')}  ${result.repos} repositories · ${c(31, `${count('high')} high`)} · ${c(33, `${count('medium')} medium`)} · ${count('low')} low${o.all ? '' : ' (--all to list)'}\n`);
  let last;
  for (const f of shown) {
    if (f.repo !== last) { console.log(c(1, printable(f.repo))); last = f.repo; }
    console.log(`  ${c(COL[f.severity], f.severity.toUpperCase().padEnd(6))}  ${printable(f.kind)}: ${c(1, printable(f.who))}  ${c(2, printable(f.detail))}`);
  }
  if (!shown.length) console.log(c(32, '  ✓ nothing to review'));
  const sk = Object.entries(result.skipped);
  if (sk.length) console.log(c(2, `\n  Not checked (token lacks permission): ${sk.slice(0, 3).map(([r, s]) => `${printable(r)}: ${s.join(', ')}`).join('; ')}${sk.length > 3 ? ` and ${sk.length - 3} more` : ''}`));
}
process.exit(failed ? 1 : 0);
