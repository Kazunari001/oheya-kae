import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {revisionHash, exportRevision} from '../src/revisions.js';
import {emptyProject, normalizeProject} from '../src/model.js';
import {importAnalysis} from '../src/detections.js';

const run = (file, ...args) => JSON.parse(execFileSync(process.execPath,
    ['bin/oheya-kae.js', '--project', file, ...args], {encoding: 'utf8'}));
const DATA_PATTERN =
  /<script id="oheya-kae-data" type="application\/json">(.*?)<\/script>/s;
const payload = (html) => JSON.parse(html.match(DATA_PATTERN)[1]);

test('revision hashes ignore key order and identify raw analysis separately',
    () => {
      assert.equal(revisionHash({b: 2, a: [1, 2]}),
          revisionHash({a: [1, 2], b: 2}));
      assert.notEqual(revisionHash([1, 2]), revisionHash([2, 1]));
      const project = emptyProject();
      const analysis = {room: {id: 'room', height: 2400}};
      importAnalysis(project, analysis, [], 'room');
      const before = exportRevision(normalizeProject(project));
      project.room.height = 2500;
      const after = exportRevision(normalizeProject(project));
      assert.equal(after.analysisRevision, before.analysisRevision);
      assert.notEqual(after.projectRevision, before.projectRevision);
      assert.equal(before.analysisRuns[0], revisionHash(analysis));
      assert.throws(() => exportRevision(project, {stage: 'wrong'}));
    });

test('CLI copies retain identity and HTML records an immutable source revision',
    async (t) => {
      const root = path.resolve('output/test');
      await mkdir(root, {recursive: true});
      const directory = await mkdtemp(path.join(root, 'revision-'));
      t.after(() => rm(directory, {recursive: true, force: true}));
      const file = path.join(directory, 'project.json');
      const copy = path.join(directory, 'copy.json');
      const htmlFile = path.join(directory, 'raw.html');
      run(file, 'room', 'create', '--width', '4000', '--depth', '5000');
      const before = run(file, 'state');
      run(file, 'export', '--output', htmlFile, '--stage', 'raw');
      const html = await readFile(htmlFile, 'utf8');
      const revisionDetails = html.match(
          /<details id="revision-details">(.*?)<\/details>/s,
      )[1];
      assert.ok(!revisionDetails.includes('license-text'));
      assert.ok(!revisionDetails.includes('The above copyright notice'));
      assert.equal(html.match(/<pre class="license-text">/g)?.length, 1);
      const first = payload(html).revision;
      assert.equal(first.projectId, before.project.projectId);
      assert.equal(first.projectRevision, before.projectRevision);
      assert.equal(first.sourceProject, file);
      assert.equal(first.stage, 'raw');
      assert.ok(Number.isFinite(Date.parse(first.exportedAt)));
      run(file, 'layout', 'save', '--output', copy);
      assert.deepEqual(run(copy, 'state').project, before.project);
      const copyHTML = path.join(directory, 'copy.html');
      run(copy, 'export', '--output', copyHTML);
      const copied = payload(await readFile(copyHTML, 'utf8')).revision;
      assert.equal(copied.projectRevision, first.projectRevision);
      assert.equal(copied.sourceProject, copy);
      run(copy, 'room', 'update', '--height', '2500');
      assert.notEqual(run(copy, 'state').projectRevision,
          first.projectRevision);
      assert.equal(await readFile(htmlFile, 'utf8'), html);
      await writeFile(copyHTML, 'preserve');
      const failure = spawnSync(process.execPath,
          ['bin/oheya-kae.js', '--project', copy, 'export', '--output',
            copyHTML, '--stage', 'wrong'], {encoding: 'utf8'});
      assert.equal(failure.status, 1);
      assert.equal(await readFile(copyHTML, 'utf8'), 'preserve');
    });
