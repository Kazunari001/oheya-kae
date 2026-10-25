import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {mutate} from '../src/store.js';
const JSON_DATA_PATTERN =
  /<script id="oheya-kae-data" type="application\/json">(.*?)<\/script>/s;
const bin = path.resolve('bin/oheya-kae.js');
function cli(project, ...args) {
  try {
    return {
      code: 0,
      ...JSON.parse(
          execFileSync(
              process.execPath,
              [bin, '--project', project, ...args],
              {encoding: 'utf8', stdio: 'pipe'},
          ),
      ),
    };
  } catch (e) {
    return {code: e.status, ...JSON.parse(e.stderr || e.stdout)};
  }
}
async function temp(t) {
  const root = path.resolve('output/test');
  await mkdir(root, {recursive: true});
  const d = await mkdtemp(path.join(root, 'oheya-kae-'));
  t.after(() => {
    assert.ok(path.resolve(d).startsWith(root + path.sep));
    return rm(d, {recursive: true, force: true});
  });
  return d;
}
test(
    'CLI creates edits validates saves loads and ' +
    'exports shared state',
    async (t) => {
      const dir = await temp(t);
      const file = path.join(dir, 'project.json');
      assert.equal(
          cli(
              file,
              'room',
              'create',
              '--width',
              '4000',
              '--depth',
              '5000',
              '--height',
              '2400',
          ).ok,
          true,
      );
      const f = cli(
          file,
          'furniture',
          'add',
          '--id',
          'desk',
          '--name',
          '机',
          '--kind',
          'desk',
          '--color',
          '#aabbcc',
          '--width',
          '1200',
          '--depth',
          '600',
          '--height',
          '720',
          '--x',
          '2000',
          '--z',
          '3000',
          '--rotation',
          '0',
      );
      assert.equal(f.objectId, 'desk');
      assert.equal(
          cli(file, 'layout', 'validate', '--strict').code,
          0,
      );
      assert.equal(
          cli(file, 'furniture', 'move', '--id', 'desk', '--x', '5000')
              .ok,
          true,
      );
      assert.equal(cli(file, 'layout', 'validate').code, 2);
      cli(
          file,
          'furniture',
          'move',
          '--id',
          'desk',
          '--x',
          '2000',
          '--rotation',
          '90',
      );
      const copy = path.join(dir, 'copy.json');
      cli(file, 'layout', 'save', '--output', copy);
      cli(file, 'furniture', 'remove', '--id', 'desk');
      cli(file, 'layout', 'load', '--input', copy);
      assert.equal(cli(file, 'state').project.furniture.length, 1);
      assert.equal(
          cli(file, 'layout', 'propose').proposals.length,
          3,
      );
      const html = path.join(dir, 'room.html');
      assert.equal(cli(file, 'export', '--output', html).ok, true);
      const text = await readFile(html, 'utf8');
      assert.ok(text.includes('oheya-kae-data'));
      assert.ok(!/<script[^>]+src=/.test(text));
      assert.ok(!/\b(?:import|export)\s*\{/.test(text));
      assert.ok(text.includes('WebGLRenderer'));
      assert.ok(!text.includes('/*OHEYA_KAE_SCRIPT*/'));
      assert.ok(
          text.includes(
              'The above copyright notice and this permission ' +
              'notice shall be included',
          ),
      );
    },
);
test('failed commands leave state intact and return JSON errors', async (t) => {
  const dir = await temp(t);
  const file = path.join(dir, 'project.json');
  cli(file, 'room', 'create', '--width', '4000', '--depth', '5000');
  const before = await readFile(file, 'utf8');
  for (const args of [
    ['room', 'create', '--width', '2000', '--depth', '2000'],
    ['furniture', 'add', '--width', '-5'],
    ['furniture', 'move', '--id', 'missing', '--x', '1000'],
    ['room', 'update', '--height', 'oops'],
    [
      'room',
      'opening',
      'add',
      '--type',
      'door',
      '--wall',
      '99',
      '--offset',
      '0',
      '--width',
      '900',
      '--height',
      '2100',
    ],
  ]) {
    const r = cli(file, ...args);
    assert.equal(r.ok, false);
    assert.equal(r.code, 1);
    assert.equal(await readFile(file, 'utf8'), before);
  }
  const r = cli(file, 'bogus');
  assert.equal(r.ok, false);
  assert.equal(r.code, 1);
});
test(
    'unknown image import preserves source and reports ' +
    'corrections; offline analysis is accepted',
    async (t) => {
      const dir = await temp(t);
      const file = path.join(dir, 'p.json');
      const image = path.join(dir, 'image.png');
      await writeFile(
          image,
          Buffer.from(
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0' +
              'lEQVR42mP8/x8AAwMCAO+jMZkAAAAASUVORK5CYII=',
              'base64',
          ),
      );
      const imported = cli(
          file,
          'room',
          'import',
          '--image',
          image,
          '--image',
          image,
      );
      assert.equal(imported.ok, true);
      assert.equal(imported.room.outline, null);
      assert.equal(imported.room.images.length, 2);
      const raw = {
        furniture: {
          name: 'Desk',
          kind: 'desk',
          color: '#aabbcc',
          width: 1200,
          depth: 600,
          height: null,
          evidence: {width: {status: 'image', note: 'printed'}},
        },
      };
      const analysis = path.join(dir, 'analysis.json');
      await writeFile(analysis, JSON.stringify(raw));
      const f = cli(
          file,
          'furniture',
          'import',
          '--image',
          image,
          '--analysis',
          analysis,
      );
      assert.equal(f.furniture.evidence.width.status, 'image');
      assert.equal(f.furniture.evidence.height.status, 'unknown');
      cli(
          file,
          'furniture',
          'update',
          '--id',
          f.objectId,
          '--height',
          '720',
          '--confirm',
          'width',
      );
      assert.equal(
          cli(file, 'state').project.furniture[0].evidence.width.status,
          'confirmed',
      );
    },
);
test('room and furniture scaling keep estimates distinguishable', async (t) => {
  const dir = await temp(t);
  const file = path.join(dir, 'p.json');
  cli(
      file,
      'room',
      'create',
      '--width',
      '2000',
      '--depth',
      '3000',
      '--height',
      '2400',
  );
  cli(
      file,
      'furniture',
      'add',
      '--id',
      'f',
      '--width',
      '1000',
      '--depth',
      '500',
      '--height',
      '700',
      '--x',
      '1000',
      '--z',
      '1000',
  );
  assert.equal(
      cli(
          file,
          'room',
          'scale',
          '--wall',
          '0',
          '--length',
          '4000',
          '--include-furniture',
      ).factor,
      2,
  );
  let p = cli(file, 'state').project;
  assert.equal(p.room.height, 2400);
  assert.equal(p.furniture[0].width, 2000);
  assert.equal(p.furniture[0].height, 700);
  cli(
      file,
      'furniture',
      'scale',
      '--id',
      'f',
      '--dimension',
      'width',
      '--length',
      '1200',
  );
  p = cli(file, 'state').project;
  assert.equal(p.furniture[0].depth, 600);
  assert.equal(p.furniture[0].evidence.width.status, 'confirmed');
  assert.equal(p.furniture[0].evidence.depth.status, 'estimated');
});
test('a concurrent mutation lock is respected', async (t) => {
  const dir = await temp(t);
  const file = path.join(dir, 'p.json');
  await writeFile(file + '.lock.tmp', '');
  const r = cli(
      file,
      'room',
      'create',
      '--width',
      '1000',
      '--depth',
      '1000',
  );
  assert.equal(r.error.code, 'PROJECT_BUSY');
});

test('scaling preserves previous values, notes and nested opening histories',
    async (t) => {
      const file = path.join(await temp(t), 'history.json');
      cli(file, 'room', 'create', '--width', '4000', '--depth', '5000');
      cli(file, 'room', 'opening', 'add', '--type', 'door', '--wall', '0',
          '--offset', '100', '--width', '800', '--height', '2000');
      cli(file, 'furniture', 'add', '--id', 'desk', '--width', '1000',
          '--depth', '500', '--x', '1000', '--z', '1000');
      cli(file, 'furniture', 'update', '--id', 'desk', '--width', '1200',
          '--status', 'estimated', '--note', '幅を仮補正');
      const before = cli(file, 'state').project;
      assert.equal(cli(file, 'room', 'scale', '--wall', '0', '--length',
          '8000', '--include-furniture').ok, true);
      const scaled = cli(file, 'state').project;
      const oldWidth = before.furniture[0].evidence.width;
      assert.deepEqual(scaled.furniture[0].evidence.width.history, [
        ...oldWidth.history,
        {value: 1200, status: oldWidth.status, note: oldWidth.note},
      ]);
      assert.deepEqual(scaled.room.evidence.outline.history.at(-1).value,
          before.room.outline);
      assert.deepEqual(scaled.room.evidence.openings.history.at(-1).value,
          before.room.openings);
      for (const key of ['offset', 'width', 'clearance']) {
        const opening = before.room.openings[0];
        assert.deepEqual(scaled.room.openings[0].evidence[key].history, [
          ...(opening.evidence[key].history ?? []),
          {value: opening[key], status: opening.evidence[key].status,
            note: opening.evidence[key].note},
        ]);
      }
      assert.equal(cli(file, 'furniture', 'scale', '--id', 'desk',
          '--dimension', 'width', '--length', '1200').ok, true);
      const item = cli(file, 'state').project.furniture[0];
      assert.deepEqual(item.evidence.width.history.slice(0, -1), [
        ...scaled.furniture[0].evidence.width.history,
        {value: 2400, status: 'estimated', note: '部屋の縮尺補正に追従。'},
      ]);
      assert.equal(item.evidence.width.status, 'confirmed');
      assert.equal(item.evidence.depth.status, 'estimated');
      assert.equal(item.evidence.height.status, 'unknown');
      assert.equal(item.height, null);
    });
test('malformed saved projects are not replaced by empty state', async (t) => {
  const dir = await temp(t);
  const file = path.join(dir, 'p.json');
  await writeFile(file, '{broken');
  assert.equal(
      cli(
          file,
          'room',
          'create',
          '--width',
          '1000',
          '--depth',
          '1000',
      ).error.code,
      'INVALID_JSON',
  );
  assert.equal(await readFile(file, 'utf8'), '{broken');
});
test('layout load restores corrupt projects and saved state', async (t) => {
  const dir = await temp(t);
  const backup = path.join(dir, 'backup.json');
  const target = path.join(dir, 'target.json');
  assert.equal(
      cli(backup, 'room', 'create', '--width', '4000', '--depth', '4000').ok,
      true,
  );
  assert.equal(
      cli(
          backup, 'furniture', 'add', '--id', 'desk',
          '--width', '1200', '--depth', '600', '--height', '720',
      ).ok,
      true,
  );
  assert.equal(cli(backup, 'layout', 'propose', '--count', '1').ok, true);
  const saved = cli(backup, 'state');
  for (const contents of ['{broken', '{"version":99}']) {
    await writeFile(target, contents);
    const restored = cli(target, 'layout', 'load', '--input', backup);
    assert.equal(restored.ok, true);
    assert.deepEqual(restored.project, saved.project);
    assert.deepEqual(restored.corrections, saved.corrections);
    assert.deepEqual(cli(target, 'state').project, saved.project);
  }
  assert.equal(cli(target, 'layout', 'load', '--input', target).ok, true);
  assert.deepEqual(cli(target, 'state').project, saved.project);
});
test('layout load preserves the destination on invalid input or locks',
    async (t) => {
      const dir = await temp(t);
      const input = path.join(dir, 'input.json');
      const target = path.join(dir, 'target.json');
      const before = '{broken destination';
      await writeFile(target, before);
      for (const [contents, code] of [
        ['{broken input', 'INVALID_JSON'],
        ['{"version":99}', 'INVALID_DATA'],
      ]) {
        await writeFile(input, contents);
        const response = cli(target, 'layout', 'load', '--input', input);
        assert.equal(response.code, 1);
        assert.equal(response.error.code, code);
        assert.equal(await readFile(target, 'utf8'), before);
      }
      const missing = cli(
          target, 'layout', 'load', '--input', path.join(dir, 'missing.json'),
      );
      assert.equal(missing.error.code, 'FILE_NOT_FOUND');
      assert.equal(await readFile(target, 'utf8'), before);
      await writeFile(input, JSON.stringify({
        version: 1, units: 'mm', room: null, furniture: [], proposals: [],
      }));
      await writeFile(target + '.lock.tmp', '');
      const locked = cli(target, 'layout', 'load', '--input', input);
      assert.equal(locked.error.code, 'PROJECT_BUSY');
      assert.equal(await readFile(target, 'utf8'), before);
    });
test(
    'HTML escaping prevents embedded names from ' +
    'terminating the JSON script',
    async (t) => {
      const dir = await temp(t);
      const file = path.join(dir, 'p.json');
      cli(
          file,
          'room',
          'create',
          '--name',
          '</script><script>alert(1)</script>',
          '--width',
          '1000',
          '--depth',
          '1000',
      );
      const output = path.join(dir, 'p.html');
      cli(file, 'export', '--output', output);
      const html = await readFile(output, 'utf8');
      assert.ok(!html.includes('</script><script>alert(1)'));
      const embedded = html.match(
          JSON_DATA_PATTERN,
      )[1];
      assert.equal(
          JSON.parse(embedded).project.room.name,
          '</script><script>alert(1)</script>',
      );
    },
);

test(
    'HTML export preserves replacement tokens and ' +
    'template markers in user data',
    async (t) => {
      const dir = await temp(t);
      const file = path.join(dir, 'p.json');
      const name =
        'Room $& $\' $` $$ /*OHEYA_KAE_SCRIPT*/ ' +
        '/*OHEYA_KAE_DATA*/ </script> </details>';
      assert.equal(
          cli(
              file,
              'room',
              'create',
              '--name',
              name,
              '--width',
              '1000',
              '--depth',
              '1000',
          ).ok,
          true,
      );
      const output = path.join(dir, 'room.html');
      assert.equal(cli(file, 'export', '--output', output).ok, true);
      const html = await readFile(output, 'utf8');
      const embedded = html.match(
          JSON_DATA_PATTERN,
      )[1];
      assert.equal(JSON.parse(embedded).project.room.name, name);
      // Script elements are checked with Chrome's HTML parser in browser-check.
    },
);

test(
    'HTML export cannot overwrite its source project, ' +
    'including Windows case aliases',
    async (t) => {
      const dir = await temp(t);
      const file = path.join(dir, 'project.json');
      cli(
          file,
          'room',
          'create',
          '--width',
          '1000',
          '--depth',
          '1000',
      );
      const before = await readFile(file, 'utf8');
      const targets = [
        file,
        path.join(dir, 'sub', '..', 'project.json'),
      ];
      if (process.platform === 'win32') {
        targets.push(path.join(dir, 'PROJECT.JSON'));
      }
      for (const output of targets) {
        const r = cli(file, 'export', '--output', output);
        assert.equal(r.code, 1);
        assert.equal(r.ok, false);
        assert.equal(await readFile(file, 'utf8'), before);
      }
      assert.equal(
          cli(file, 'export', '--format', 'json', '--output', file).ok,
          true,
      );
      assert.equal(await readFile(file, 'utf8'), before);
    },
);

test('null update fields never confirm fabricated defaults', async (t) => {
  const dir = await temp(t);
  const file = path.join(dir, 'p.json');
  const patch = path.join(dir, 'patch.json');
  cli(
      file,
      'room',
      'create',
      '--width',
      '4000',
      '--depth',
      '5000',
      '--height',
      '2400',
  );
  cli(
      file,
      'furniture',
      'add',
      '--id',
      'desk',
      '--name',
      'Desk',
      '--kind',
      'desk',
      '--color',
      '#aabbcc',
      '--width',
      '1000',
      '--depth',
      '600',
      '--height',
      '720',
      '--x',
      '2000',
      '--z',
      '2500',
      '--rotation',
      '90',
  );
  assert.equal(cli(file, 'layout', 'validate', '--strict').code, 0);
  const before = await readFile(file, 'utf8');
  for (const field of [
    'name',
    'kind',
    'color',
    'x',
    'z',
    'rotation',
  ]) {
    await writeFile(patch, JSON.stringify({[field]: null}));
    assert.equal(
        cli(
            file,
            'furniture',
            'update',
            '--id',
            'desk',
            '--data',
            patch,
        ).code,
        1,
    );
    assert.equal(await readFile(file, 'utf8'), before);
  }
  for (const field of ['name', 'openings']) {
    await writeFile(patch, JSON.stringify({[field]: null}));
    assert.equal(
        cli(file, 'room', 'update', '--data', patch).code,
        1,
    );
    assert.equal(await readFile(file, 'utf8'), before);
  }
  await writeFile(patch, JSON.stringify({height: null}));
  const changed = cli(
      file,
      'furniture',
      'update',
      '--id',
      'desk',
      '--data',
      patch,
  );
  assert.equal(changed.ok, true);
  assert.equal(changed.furniture.height, null);
  assert.equal(changed.furniture.evidence.height.status, 'unknown');
  assert.equal(cli(file, 'layout', 'validate', '--strict').code, 2);
});

test(
    'room and furniture IDs cannot be cleared or ' +
    'replaced through update JSON',
    async (t) => {
      const dir = await temp(t);
      const file = path.join(dir, 'p.json');
      const patch = path.join(dir, 'patch.json');
      const created = cli(
          file,
          'room',
          'create',
          '--width',
          '1000',
          '--depth',
          '1000',
      );
      cli(file, 'furniture', 'add', '--id', 'desk');
      const before = await readFile(file, 'utf8');
      for (const id of [null, '', 'replacement']) {
        await writeFile(patch, JSON.stringify({id}));
        for (const args of [
          ['room', 'update'],
          ['furniture', 'update', '--id', 'desk'],
        ]) {
          assert.equal(cli(file, ...args, '--data', patch).code, 1);
          assert.equal(await readFile(file, 'utf8'), before);
        }
      }
      await writeFile(patch, JSON.stringify({id: created.objectId}));
      assert.equal(
          cli(file, 'room', 'update', '--data', patch).objectId,
          created.objectId,
      );
      await writeFile(patch, JSON.stringify({id: 'desk'}));
      assert.equal(
          cli(
              file,
              'furniture',
              'update',
              '--id',
              'desk',
              '--data',
              patch,
          ).objectId,
          'desk',
      );
    },
);

test(
    'invalid analysis objects cannot replace a room or ' +
    'add furniture',
    async (t) => {
      const dir = await temp(t);
      const file = path.join(dir, 'p.json');
      const analysis = path.join(dir, 'analysis.json');
      const image = path.join(dir, 'image.png');
      await writeFile(
          image,
          Buffer.from(
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0' +
              'lEQVR42mP8/x8AAwMCAO+jMZkAAAAASUVORK5CYII=',
              'base64',
          ),
      );
      cli(
          file,
          'room',
          'create',
          '--width',
          '4000',
          '--depth',
          '5000',
      );
      const before = await readFile(file, 'utf8');
      for (const kind of ['room', 'furniture']) {
        const invalid = [
          null,
          [],
          42,
          'not an analysis object',
          {[kind]: null},
          {[kind]: []},
          {[kind]: 'invalid'},
        ];
        if (kind === 'room') {
          invalid.push(
              {room: {}, furniture: {}},
              {room: {}, furniture: [null]},
              {room: {}, furniture: ['invalid']},
          );
        } else {
          invalid.push({room: {}});
        }
        for (const data of invalid) {
          await writeFile(analysis, JSON.stringify(data));
          const r = cli(
              file,
              kind,
              'import',
              ...(kind === 'room' ? ['--replace'] : []),
              '--image',
              image,
              '--analysis',
              analysis,
          );
          assert.equal(r.code, 1, JSON.stringify(data));
          assert.equal(r.ok, false);
          assert.equal(await readFile(file, 'utf8'), before);
        }
      }
      // Raw partial objects remain supported alongside documented wrappers.
      await writeFile(analysis, JSON.stringify({width: 1200}));
      assert.equal(
          cli(
              file,
              'furniture',
              'import',
              '--image',
              image,
              '--analysis',
              analysis,
          ).furniture.width,
          1200,
      );
    },
);

test(
    'imports reject removed API options without ' +
    'modifying a project',
    async (t) => {
      const dir = await temp(t);
      const file = path.join(dir, 'p.json');
      cli(
          file,
          'room',
          'create',
          '--width',
          '4000',
          '--depth',
          '5000',
      );
      const before = await readFile(file, 'utf8');
      for (const kind of ['room', 'furniture']) {
        const help = execFileSync(
            process.execPath,
            [bin, kind, 'import', '--help'],
            {encoding: 'utf8'},
        );
        assert.match(help, /--analysis/);
        assert.doesNotMatch(help, /--analyze|--model|--context/);
        for (const options of [
          ['--analyze'],
          ['--model', 'unused'],
          ['--context', 'width is 4000'],
        ]) {
          const r = cli(
              file,
              kind,
              'import',
              '--image',
              'missing.png',
              ...options,
          );
          assert.equal(r.code, 1);
          assert.equal(r.error.code, 'commander.unknownOption');
          assert.equal(await readFile(file, 'utf8'), before);
        }
      }
    },
);

test(
    'caller-side analysis workflow imports local JSON ' +
    'while fetch is disabled',
    async (t) => {
      const dir = await temp(t);
      const file = path.join(dir, 'p.json');
      const image = path.join(dir, 'source.png');
      const analysis = path.join(dir, 'analysis.json');
      const guard = path.join(dir, 'no-network.mjs');
      await writeFile(
          image,
          Buffer.from(
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0' +
              'lEQVR42mP8/x8AAwMCAO+jMZkAAAAASUVORK5CYII=',
              'base64',
          ),
      );
      await writeFile(
          guard,
          'globalThis.fetch = () => { process.exit(99); };\n',
      );
      const offline = (...args) =>
        JSON.parse(
            execFileSync(
                process.execPath,
                [
                  '--import',
                  pathToFileURL(guard).href,
                  bin,
                  '--project',
                  file,
                  ...args,
                ],
                {
                  encoding: 'utf8',
                  env: {
                    ...process.env,
                    OPENAI_API_KEY: 'unused-test-key',
                    OHEYA_KAE_MODEL: 'unused-test-model',
                  },
                },
            ),
        );
      for (const kind of ['room', 'furniture']) {
        const contract = offline('schema', '--kind', kind);
        assert.ok(contract.schema.properties[kind]);
        assert.ok(contract.prompt);
      }
      await writeFile(
          analysis,
          JSON.stringify({
            room: {
              outline: [
                [0, 0],
                [4000, 0],
                [4000, 5000],
                [0, 5000],
              ],
              height: null,
            },
            furniture: [],
          }),
      );
      const imported = offline(
          'room',
          'import',
          '--image',
          image,
          '--analysis',
          analysis,
      );
      assert.equal(imported.ok, true);
      assert.equal(imported.room.images.length, 1);
      assert.equal(imported.room.height, null);
      await writeFile(
          analysis,
          JSON.stringify({
            furniture: {
              width: 1200,
              depth: 600,
              height: null,
              evidence: {width: {status: 'image'}},
            },
          }),
      );
      const furniture = offline(
          'furniture',
          'import',
          '--image',
          image,
          '--analysis',
          analysis,
      ).furniture;
      assert.equal(furniture.width, 1200);
      assert.equal(furniture.evidence.width.status, 'image');
      assert.equal(furniture.evidence.height.status, 'unknown');
      const unknown = offline(
          'furniture',
          'import',
          '--image',
          image,
      ).furniture;
      assert.equal(unknown.width, null);
      assert.equal(unknown.evidence.width.status, 'unknown');
    },
);

test(
    'save and JSON export respect destination locks and ' +
    'retain successful edits',
    async (t) => {
      const dir = await temp(t);
      const source = path.join(dir, 'source.json');
      const target = path.join(dir, 'target.json');
      cli(
          source,
          'room',
          'create',
          '--name',
          'Copy',
          '--width',
          '1000',
          '--depth',
          '1000',
      );
      cli(
          target,
          'room',
          'create',
          '--name',
          'Original',
          '--width',
          '2000',
          '--depth',
          '2000',
      );
      const before = await readFile(target, 'utf8');
      const outputs = [target];
      if (process.platform === 'win32') {
        outputs.push(path.join(dir, 'TARGET.JSON'));
      }
      await mutate(target, async (p) => {
        p.room.name = 'Edited';
        for (const input of [source, target]) {
          for (const output of outputs) {
            for (const args of [
              ['layout', 'save'],
              ['export', '--format', 'json'],
            ]) {
              const r = cli(input, ...args, '--output', output);
              assert.equal(r.error.code, 'PROJECT_BUSY');
              assert.equal(r.code, 1);
              assert.equal(await readFile(target, 'utf8'), before);
            }
          }
        }
      });
      assert.equal(cli(target, 'state').project.room.name, 'Edited');
      assert.equal(
          cli(target, 'layout', 'save', '--output', target).ok,
          true,
      );
      assert.equal(cli(target, 'state').project.room.name, 'Edited');
      assert.equal(
          cli(source, 'export', '--format', 'json', '--output', target)
              .ok,
          true,
      );
      assert.equal(cli(target, 'state').project.room.name, 'Copy');
    },
);
