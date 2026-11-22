// Builds a standalone executable with Node's Single Executable Applications (node --build-sea).
// No bundler dependency: the CLI and its src/ modules only import node: builtins and each other,
// so they are merged into one ES module here. Needs Node 25.5+ (ES module main for SEA).
//   node scripts/build-exe.mjs               -> dist/<name>[.exe]
//   node scripts/build-exe.mjs --bundle-only -> dist/<name>.mjs (used by the tests)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const [name, entry] = Object.entries(pkg.bin)[0];
const dist = join(root, 'dist');
const VERSION_READ = "JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version";

const named = new Map(), namespaces = new Map(), modules = new Map(); // path -> { code, exports }
const exportsOf = (code) => [...code.matchAll(/^export (?:async )?(?:function|const|let|class) (\w+)/gm)].map((m) => m[1]);

// Depth-first: dependencies are emitted before the module that imports them.
const order = [];
function load(file) {
  if (modules.has(file)) return modules.get(file);
  const rel = relative(root, file).replace(/\\/g, '/');
  let code = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/^#!.*\n/, '');
  const mod = { code: '', exports: exportsOf(code), ns: `__module_${rel.replace(/\W/g, '_')}`, dynamic: false };
  modules.set(file, mod);
  code = code.replace(/^import (.+?) from '([^']+)';\n/gm, (line, what, from) => {
    if (from.startsWith('.')) { load(resolve(dirname(file), from)); return ''; }
    if (!from.startsWith('node:')) throw new Error(`${rel}: only node: and relative imports can be bundled (${from})`);
    const ns = /^\* as (\w+)$/.exec(what);
    if (ns) { namespaces.set(ns[1], from); return ''; }
    const names = /^\{([^}]+)\}$/.exec(what);
    if (!names) throw new Error(`${rel}: unsupported import: ${line}`);
    const set = named.get(from) ?? new Set();
    for (const n of names[1].split(',').map((s) => s.trim()).filter(Boolean)) set.add(n);
    named.set(from, set);
    return '';
  });
  // await import('./x.js') of our own modules becomes a top-level object holding that module's exports
  // (its own name, so `const { a } = ...` inside a block can't shadow the function it reads).
  code = code.replace(/await import\('(\.[^']+)'\)/g, (_, from) => { const m = load(resolve(dirname(file), from)); m.dynamic = true; return m.ns; });
  code = code.split(VERSION_READ).join(JSON.stringify(pkg.version));
  code = code.replace(/^export (?=(?:async )?(?:function|const|let|class) )/gm, '');
  if (/^export /m.test(code)) throw new Error(`${rel}: unsupported export form`);
  mod.code = `// --- ${rel}\n${code}`;
  mod.finish = () => (mod.dynamic ? `${mod.code}\nconst ${mod.ns} = { ${mod.exports.join(', ')} };` : mod.code);
  order.push(mod);
  return mod;
}
load(join(root, entry));

const imports = [...named].map(([from, set]) => `import { ${[...set].join(', ')} } from '${from}';`)
  .concat([...namespaces].map(([id, from]) => `import * as ${id} from '${from}';`)).join('\n');
const bundle = `// ${name} ${pkg.version}, bundled for a standalone executable. Source: ${pkg.repository?.url ?? ''}\n${imports}\n${order.map((m) => m.finish()).join('\n')}`;
mkdirSync(dist, { recursive: true });
const bundlePath = join(dist, `${name}.mjs`);
writeFileSync(bundlePath, bundle);
execFileSync(process.execPath, ['--check', bundlePath]); // catches duplicate names between modules
console.log(`bundle: ${bundlePath}`);
if (process.argv.includes('--bundle-only')) process.exit(0);

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 25 || (major === 25 && minor < 5)) throw new Error(`node --build-sea with an ES module needs Node 25.5+, this is ${process.version}`);
const exe = join(dist, process.platform === 'win32' ? `${name}.exe` : name);
const config = join(dist, 'sea-config.json');
writeFileSync(config, JSON.stringify({ main: bundlePath, mainFormat: 'module', output: exe, disableExperimentalSEAWarning: true, useCodeCache: false }));
execFileSync(process.execPath, ['--build-sea', config], { stdio: 'inherit' });
if (process.platform === 'darwin') execFileSync('codesign', ['--sign', '-', '--force', exe], { stdio: 'inherit' }); // ad-hoc signature so macOS runs it
console.log(`executable: ${exe}`);
