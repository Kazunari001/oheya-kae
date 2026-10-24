import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {appendFile, mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const metadata = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'Run this check with npm run test:package.');

/**
 * Run npm with the same Node.js executable, without shell interpolation.
 * @param {!Array<string>} args npm arguments.
 * @param {string} cwd Working directory, independent of the source checkout.
 * @return {string} Captured stdout; failures include npm diagnostics.
 */
function npm(args, cwd = root) {
  return execFileSync(process.execPath, [npmCli, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

const destination = path.join(root, 'output', 'packages');
await mkdir(destination, {recursive: true});
// pretest:package already built the viewer. Pack exactly that verified output.
const [packed] = JSON.parse(npm([
  'pack', '--json', '--ignore-scripts', '--pack-destination', destination,
]));
const files = new Set(packed.files.map((file) => file.path));
for (const required of [
  'package.json', 'LICENSE', 'README.md', 'bin/oheya-kae.js',
  'src/export.js', 'src/detection-report.js',
  'viewer/index.html', 'viewer/viewer.css',
  'dist/viewer.js', 'dist/THREE-LICENSE.txt',
]) {
  assert.ok(files.has(required), `Package is missing ${required}`);
}
assert.ok(!files.has('src/jev.js'), 'Package contains the obsolete converter');
for (const file of files) {
  assert.ok(
      !/^(?:output|node_modules|test|scripts|\.github)\//.test(file),
      `Unexpected development file in package: ${file}`,
  );
  assert.ok(!/(?:^|\/)\.env(?:\.|$)/.test(file));
}

const tarball = path.join(destination, packed.filename);
const temporaryRoot = path.resolve(tmpdir());
const installDirectory = await mkdtemp(
    path.join(temporaryRoot, 'oheya-kae-package-'),
);
try {
  await writeFile(
      path.join(installDirectory, 'package.json'),
      JSON.stringify({name: 'package-smoke-test', private: true}),
  );
  npm([
    'install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund',
    '--package-lock=false', tarball,
  ], installDirectory);
  const installed = path.join(
      installDirectory, 'node_modules', metadata.name,
  );
  const cli = path.join(installed, 'bin', 'oheya-kae.js');
  const binName = process.platform === 'win32' ? 'oheya-kae.cmd' : 'oheya-kae';
  assert.ok(await stat(
      path.join(installDirectory, 'node_modules', '.bin', binName),
  ));
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], {
    cwd: installDirectory,
    encoding: 'utf8',
  });
  assert.equal(run('--version').trim(), metadata.version);
  run('room', 'create', '--width', '4000', '--depth', '5000');
  const htmlPath = path.join(installDirectory, 'room.html');
  const exported = JSON.parse(run('export', '--output', htmlPath));
  assert.equal(exported.ok, true);
  const html = await readFile(htmlPath, 'utf8');
  assert.ok(html.includes('<style>'));
  assert.ok(html.includes('WebGLRenderer'));
  assert.ok(html.includes('The above copyright notice'));
  assert.ok(!html.includes('href="./viewer.css"'));
  assert.ok(!/<script[^>]+src=/.test(html));
  assert.ok(!html.includes('/*OHEYA_KAE_SCRIPT*/'));
} finally {
  // Delete only the unique temporary child created by this invocation.
  const resolvedDirectory = path.resolve(installDirectory);
  assert.ok(resolvedDirectory.startsWith(temporaryRoot + path.sep));
  await rm(installDirectory, {recursive: true, force: true});
}

if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `tarball=${tarball}\n`);
}
console.log(`Package installed and exported offline HTML: ${tarball}`);
