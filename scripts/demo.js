import {execFileSync} from 'node:child_process';
import {mkdir, rm} from 'node:fs/promises';
import path from 'node:path';

await mkdir('output', {recursive: true});
const project = path.resolve('output/demo.json');
// This script only regenerates its named demo artifact.
await rm(project, {force: true});
function cli(...args) {
  return JSON.parse(
      execFileSync(
          process.execPath,
          ['bin/oheya-kae.js', '--project', project, ...args],
          {encoding: 'utf8'},
      ),
  );
}
cli(
    'room',
    'create',
    '--name',
    'ひとり暮らしの部屋',
    '--width',
    '4000',
    '--depth',
    '5000',
    '--height',
    '2400',
);
cli(
    'room',
    'opening',
    'add',
    '--id',
    'entry',
    '--type',
    'door',
    '--wall',
    '0',
    '--offset',
    '400',
    '--width',
    '900',
    '--height',
    '2100',
    '--sill',
    '0',
    '--clearance',
    '1000',
);
cli(
    'room',
    'opening',
    'add',
    '--id',
    'window',
    '--type',
    'window',
    '--wall',
    '2',
    '--offset',
    '1000',
    '--width',
    '1800',
    '--height',
    '1000',
    '--sill',
    '900',
    '--clearance',
    '900',
);
for (const f of [
  [
    'bed',
    'ベッド',
    'bed',
    '#b7b9a0',
    1400,
    2000,
    480,
    3000,
    3600,
    0,
  ],
  [
    'desk',
    'ワークデスク',
    'desk',
    '#b99069',
    1400,
    700,
    730,
    1100,
    4300,
    0,
  ],
  [
    'sofa',
    'ソファ',
    'sofa',
    '#819684',
    1400,
    800,
    850,
    3300,
    1100,
    90,
  ],
  [
    'shelf',
    '本棚',
    'shelf',
    '#c6b391',
    800,
    350,
    1800,
    350,
    2400,
    90,
  ],
]) {
  const keys = [
    'id',
    'name',
    'kind',
    'color',
    'width',
    'depth',
    'height',
    'x',
    'z',
    'rotation',
  ];
  cli(
      'furniture',
      'add',
      ...f.flatMap((v, i) => [`--${keys[i]}`, String(v)]),
  );
}
cli(
    'layout',
    'propose',
    '--preference',
    '通路を広く',
    '--count',
    '3',
    '--step',
    '200',
    '--clearance',
    '400',
);
cli('export', '--output', 'output/demo.html');
console.log('Created output/demo.json and output/demo.html');
