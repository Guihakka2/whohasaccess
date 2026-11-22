// whohasaccess core: read-only GitHub access audit. Only GET requests, the token only goes to the API host.

export const printable = (s) => String(s).replace(/[\x00-\x1f\x7f-\x9f]/g, '?');
const DAY = 86400000;
const MAX_PAGES = 10; // 1,000 items per list
export const SEVERITY = { high: 3, medium: 2, low: 1 };

// GITHUB_API_URL (set in GitHub Actions, GHES) must be https, except localhost for tests.
export function apiBase(env = process.env) {
  const u = new URL(env.GITHUB_API_URL || 'https://api.github.com');
  if (u.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) throw new Error('GITHUB_API_URL must use https');
  return u.origin + u.pathname.replace(/\/$/, '');
}

export function client({ base, token, fetch: fetchImpl = fetch, timeout = 15000 }) {
  const get = async (path) => {
    const res = await fetchImpl(path.startsWith(base) ? path : base + path, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'whohasaccess' },
      redirect: 'error', signal: AbortSignal.timeout(timeout),
    });
    if (res.status === 401) throw new Error('GitHub rejected the token (401)');
    if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') throw new Error('GitHub API rate limit reached, try again later');
    if (res.status === 403 || res.status === 404) return { denied: true, data: [] };
    if (!res.ok) throw new Error(`GitHub API ${res.status} on ${path.split('?')[0]}`);
    return { data: await res.json(), next: /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '')?.[1] };
  };
  const list = async (path) => {
    let url = `${path}${path.includes('?') ? '&' : '?'}per_page=100`, out = [], denied = false;
    for (let i = 0; url && i < MAX_PAGES; i++) {
      const r = await get(url);
      if (r.denied) { denied = true; break; }
      out = out.concat(r.data);
      // Only follow pagination links on the same API host.
      url = r.next && new URL(r.next).origin === new URL(base).origin ? r.next : null;
    }
    return { items: out, denied };
  };
  return { get, list };
}

const age = (iso, now) => (iso ? Math.floor((now - new Date(iso).getTime()) / DAY) : null);
const hostOf = (u) => { try { const x = new URL(u); return { host: x.host, https: x.protocol === 'https:' }; } catch { return { host: '?', https: false }; } };

// Findings for one repository. `owner` is the account login (owners always have access, not reported).
export async function auditRepo(api, repo, { now = Date.now(), staleDays = 90 } = {}) {
  const f = [], skipped = [];
  const add = (severity, kind, who, detail) => f.push({ repo: repo.full_name, severity, kind, who, detail });
  const owner = repo.owner?.login;

  const collab = await api.list(`/repos/${repo.full_name}/collaborators?affiliation=outside`);
  if (collab.denied) skipped.push('collaborators');
  for (const c of collab.items.filter((x) => x.login !== owner)) {
    const p = c.role_name ?? (c.permissions?.admin ? 'admin' : c.permissions?.maintain ? 'maintain' : c.permissions?.push ? 'write' : 'read');
    add(p === 'admin' ? 'high' : ['maintain', 'write'].includes(p) ? 'medium' : 'low', 'outside collaborator', c.login, `${p} access`);
  }
  const inv = await api.list(`/repos/${repo.full_name}/invitations`);
  for (const i of inv.items) {
    const d = age(i.created_at, now);
    add(d > 7 ? 'medium' : 'low', 'pending invitation', i.invitee?.login ?? i.email ?? '?', `${i.permissions} access, sent ${d}d ago`);
  }
  const keys = await api.list(`/repos/${repo.full_name}/keys`);
  if (keys.denied) skipped.push('deploy keys');
  for (const k of keys.items) {
    const used = k.last_used ? `last used ${age(k.last_used, now)}d ago` : 'never used';
    const stale = !k.last_used ? age(k.created_at, now) > staleDays : age(k.last_used, now) > staleDays;
    const sev = !k.read_only ? (stale ? 'high' : 'medium') : stale ? 'medium' : 'low';
    add(sev, `deploy key (${k.read_only ? 'read-only' : 'WRITE'})`, k.title || `key ${k.id}`, `added ${age(k.created_at, now)}d ago, ${used}`);
  }
  const hooks = await api.list(`/repos/${repo.full_name}/hooks`);
  if (hooks.denied) skipped.push('webhooks');
  for (const h of hooks.items) {
    const { host, https } = hostOf(h.config?.url);
    const failing = h.last_response?.code && h.last_response.code >= 400;
    const insecure = h.config?.insecure_ssl === '1' || h.config?.insecure_ssl === 1;
    const sev = !https || insecure ? 'high' : failing || !h.active ? 'medium' : 'low';
    const notes = [!https && 'not https', insecure && 'TLS check disabled', !h.active && 'inactive', failing && `last delivery ${h.last_response.code}`].filter(Boolean);
    add(sev, 'webhook', host, `${(h.events ?? []).join(', ') || 'push'}${notes.length ? ` (${notes.join(', ')})` : ''}`);
  }
  return { findings: f, skipped, owner };
}

export async function auditOrg(api, org) {
  const f = [], skipped = [];
  const add = (severity, kind, who, detail) => f.push({ repo: `org:${org}`, severity, kind, who, detail });
  const no2fa = await api.list(`/orgs/${org}/members?filter=2fa_disabled`);
  if (no2fa.denied) skipped.push('2FA status (needs org owner)');
  for (const m of no2fa.items) add('high', 'member without 2FA', m.login, 'can sign in with a password only');
  const admins = await api.list(`/orgs/${org}/members?role=admin`);
  for (const m of admins.items) add('low', 'org owner', m.login, 'full control of the organization');
  const apps = await api.list(`/orgs/${org}/installations`);
  if (apps.denied) skipped.push('installed apps (needs admin:org)');
  for (const a of (apps.items[0]?.installations ? apps.items.flatMap((p) => p.installations) : apps.items)) {
    const write = Object.entries(a.permissions ?? {}).filter(([, v]) => v === 'write' || v === 'admin').map(([k]) => k);
    add(write.length && a.repository_selection === 'all' ? 'medium' : 'low', 'GitHub App', a.app_slug ?? '?', `${a.repository_selection} repos${write.length ? `, write: ${write.slice(0, 5).join(', ')}${write.length > 5 ? '…' : ''}` : ', read-only'}`);
  }
  return { findings: f, skipped };
}
