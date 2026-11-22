// Minimal MCP server over stdio (JSON-RPC 2.0, one message per line). No dependencies.
// Each tool validates its arguments, then runs this package's own CLI with --json (no shell).
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { relative, resolve, isAbsolute } from 'node:path';

const PROTOCOLS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'];

export const insideCwd = (p) => { const r = relative(process.cwd(), resolve(p)); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };

// Checks arguments against the tool's inputSchema (the subset we use). Returns an error string or null.
function checkSchema(schema, a) {
  if (a === undefined) a = {};
  if (typeof a !== 'object' || a === null || Array.isArray(a)) return 'arguments must be an object';
  for (const [k, v] of Object.entries(a)) {
    const s = schema.properties[k];
    if (!s) return `unknown argument "${k}"`;
    if (s.type === 'string' && (typeof v !== 'string' || v.length > (s.maxLength ?? 500))) return `"${k}" must be a string${s.maxLength ? ` up to ${s.maxLength} characters` : ''}`;
    if (s.type === 'boolean' && typeof v !== 'boolean') return `"${k}" must be true or false`;
    if (s.type === 'integer' && (!Number.isInteger(v) || v < (s.minimum ?? 0) || v > (s.maximum ?? 1e9))) return `"${k}" must be a whole number`;
    if (s.type === 'array' && !(Array.isArray(v) && v.length <= (s.maxItems ?? 100) && v.every((x) => typeof x === 'string' && x.length <= 500))) return `"${k}" must be a list of strings`;
    if (s.enum && !s.enum.includes(v)) return `"${k}" must be one of ${s.enum.join(', ')}`;
  }
  for (const k of schema.required ?? []) if (a[k] === undefined) return `"${k}" is required`;
  return null;
}

// Runs the CLI and returns its parsed --json output. okCodes: exit codes that still mean "a result".
export function runCli(bin, argv, { input, okCodes = [0, 1], timeout = 120000 } = {}) {
  return new Promise((done) => {
    const p = spawn(process.execPath, [bin, ...argv], { cwd: process.cwd(), env: { ...process.env, NO_COLOR: '1' }, windowsHide: true });
    let out = '', err = '';
    p.stdout.on('data', (d) => { if (out.length < 10e6) out += d; });
    p.stderr.on('data', (d) => { if (err.length < 1e5) err += d; });
    p.stdin.on('error', () => {});
    p.stdin.end(input ?? '');
    const timer = setTimeout(() => p.kill(), timeout);
    p.on('close', (code) => {
      clearTimeout(timer);
      if (okCodes.includes(code)) { try { return done({ ok: true, result: JSON.parse(out) }); } catch {} }
      done({ ok: false, message: err.trim().split('\n')[0] || `exited with code ${code}` });
    });
  });
}

// tools: [{ name, title, description, inputSchema, annotations, validate?(args) -> error|null, run(args) -> { ok, result | message }, note? }]
export function serveMcp({ name, version, instructions, tools }) {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const write = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
  const text = (id, t, isError) => write({ id, result: { content: [{ type: 'text', text: t }], ...(isError && { isError: true }) } });
  const handle = async (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return write({ id: null, error: { code: -32700, message: 'Parse error' } }); }
    const { id, method, params } = msg ?? {};
    if (id === undefined) return; // notifications need no answer
    if (method === 'initialize') {
      const asked = params?.protocolVersion;
      return write({ id, result: { protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS.at(-1), capabilities: { tools: {} }, serverInfo: { name, version }, instructions } });
    }
    if (method === 'ping') return write({ id, result: {} });
    if (method === 'tools/list') return write({ id, result: { tools: tools.map(({ validate, run, note, ...t }) => t) } });
    if (method === 'tools/call') {
      const tool = tools.find((t) => t.name === params?.name);
      if (!tool) return write({ id, error: { code: -32602, message: `Unknown tool: ${params?.name}` } });
      const args = params.arguments ?? {};
      const bad = checkSchema(tool.inputSchema, args) ?? tool.validate?.(args);
      if (bad) return text(id, `${name}: ${bad}`, true);
      const r = await tool.run(args);
      if (!r.ok) return text(id, `${name}: ${r.message}`, true);
      return write({ id, result: { content: [{ type: 'text', text: (tool.note ? `${tool.note}\n` : '') + JSON.stringify(r.result, null, 2) }], structuredContent: r.result } });
    }
    write({ id, error: { code: -32601, message: `Method not found: ${method}` } });
  };
  const pending = new Set();
  rl.on('line', (line) => { const p = handle(line); pending.add(p); p.finally(() => pending.delete(p)); });
  // Resolves when the client closes stdin, after in-flight calls have answered.
  return new Promise((done) => rl.on('close', async () => { await Promise.allSettled([...pending]); done(); }));
}
