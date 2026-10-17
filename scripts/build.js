import {build} from 'esbuild';
import {copyFile} from 'node:fs/promises';
await build({
  entryPoints: ['viewer/viewer.js'],
  bundle: true,
  format: 'iife',
  target: ['es2022'],
  minify: true,
  legalComments: 'inline',
  outfile: 'dist/viewer.js',
});
await copyFile(
    'node_modules/three/LICENSE',
    'dist/THREE-LICENSE.txt',
);
console.log('Built offline viewer: dist/viewer.js');
