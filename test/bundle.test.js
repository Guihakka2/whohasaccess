import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The standalone executables are built from this bundle (scripts/build-exe.mjs): it must behave like the CLI.
test('standalone bundle builds and behaves like the CLI', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const [name, entry] = Object.entries(pkg.bin)[0];
  const build = spawnSync(process.execPath, ['scripts/build-exe.mjs', '--bundle-only'], { cwd: root, encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  const run = (file, args) => spawnSync(process.execPath, [file, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  const bundle = `dist/${name}.mjs`;
  assert.equal(run(bundle, ['--version']).stdout.trim(), pkg.version);
  const help = run(bundle, ['--help']), cliHelp = run(entry, ['--help']);
  assert.equal(help.status, 0);
  assert.equal(help.stdout, cliHelp.stdout);
  const bad = run(bundle, ['--definitely-not-an-option']);
  assert.equal(bad.status, 2);
  if (cliHelp.stdout.includes('--mcp')) {
    const msg = (m) => JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n';
    const input = msg({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }) + msg({ id: 2, method: 'tools/list' });
    const mcp = spawnSync(process.execPath, [bundle, '--mcp'], { cwd: root, input, encoding: 'utf8' });
    assert.equal(mcp.status, 0, mcp.stderr);
    const [hello, list] = mcp.stdout.trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(hello.result.serverInfo.name, name);
    assert.ok(list.result.tools.length > 0);
  }
});
