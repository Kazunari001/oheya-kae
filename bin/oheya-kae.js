#!/usr/bin/env node
import {Command, InvalidArgumentError} from 'commander';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {AppError, requireValue} from '../src/errors.js';
import {normalizeRoom, normalizeFurniture, corrections, confirmed, revise, number, object, KINDS} from '../src/model.js';
import {load, mutate, readJSON, saveCopy, sameFile} from '../src/store.js';
import {readImages, analysisSchema, analysisPrompt} from '../src/analysis.js';
import {validate, applyPlacements} from '../src/validation.js';
import {propose} from '../src/proposals.js';
import {exportHTML} from '../src/export.js';

const packageMetadata = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const cli = new Command()
    .name('oheya-kae')
    .description(
        'AI向けの部屋・物体レイアウトCLI。単位:mm、位置:x,z中心と底面高さy。',
    )
    .version(packageMetadata.version);
cli
    .option(
        '-p, --project <path>',
        'Project JSON file',
        'oheya-kae.json',
    )
    .option('--json', 'JSON output (always enabled)');
cli.exitOverride().configureOutput({writeErr: () => {}});
const numeric = (value) => {
  if (!value.trim() || !Number.isFinite(Number(value))) {
    throw new InvalidArgumentError('Expected a finite number');
  }
  return Number(value);
};
const repeat = (v, a) => [...a, v];
const result = (data) =>
  process.stdout.write(JSON.stringify({ok: true, ...data}) + '\n');
const projectPath = () => cli.opts().project;
/**
 * Persist one CLI mutation and invalidate proposals unless explicitly kept.
 * @param {function(!Object): *} action Edits a normalized project in mm.
 * @return {!Promise<*>} Writes the mutation result and corrections as JSON.
 */
const changed = async (action) =>
  result(
      await mutate(projectPath(), async (project) => {
        const actionResult = await action(project);
        if (!actionResult?.keepProposals) {
          project.proposals = [];
        }
        return {...actionResult, corrections: corrections(project)};
      }),
  );
const needRoom = (project) => {
  if (!project.room) {
    throw new AppError(
        'ROOM_NOT_FOUND',
        'Create or import a room first',
    );
  }
  return project.room;
};
const needFurniture = (project, id) => {
  const item = project.furniture.find((item) => item.id === id);
  if (!item) {
    throw new AppError(
        'OBJECT_NOT_FOUND',
        `Furniture not found: ${id}`,
    );
  }
  return item;
};
const FURNITURE_FIELDS = [
  'name',
  'kind',
  'color',
  'width',
  'depth',
  'height',
  'x',
  'z',
  'rotation',
  'y', 'category', 'sourceId', 'parentId', 'attachment', 'surfaceId',
  'wall', 'supports', 'frameThickness',
];
function geometryOptions(command) {
  return command
      .option('--width <mm>', 'Width', numeric)
      .option('--depth <mm>', 'Depth', numeric)
      .option('--height <mm>', 'Height', numeric);
}
function furnitureOptions(command) {
  return geometryOptions(command)
      .option('--name <name>')
      .option(
          '--kind <kind>',
          KINDS.join('|'),
      )
      .option('--color <hex>', '#RRGGBB')
      .option('--x <mm>', 'Footprint center X', numeric)
      .option('--z <mm>', 'Footprint center Z', numeric)
      .option('--y <mm>', 'Bottom elevation, relative to parent', numeric)
      .option('--category <category>', 'Semantic object category')
      .option('--source-id <id>', 'Source detection identifier')
      .option('--parent-id <id>', 'Parent item or room identifier')
      .option('--attachment <type>', 'floor|on|inside|wall|part')
      .option('--surface-id <id>', 'Parent support surface identifier')
      .option('--wall <index>', 'Room wall index for wall attachments', numeric)
      .option('--rotation <degrees>', 'Y-axis rotation', numeric);
}
function importOptions(command) {
  return command
      .requiredOption(
          '--image <path>',
          'Source image to store locally; repeat for multiple images',
          repeat,
          [],
      )
      .option(
          '--analysis <json>',
          'Local analysis JSON prepared by the calling AI',
      );
}
/**
 * Load source images and optional analysis from local files.
 * @param {string} kind Expected analysis kind: room or furniture.
 * @param {!Object} options Parsed CLI options with image and analysis paths.
 * @return {!Promise<!Object>} Validated images and optional analysis data.
 */
async function importData(kind, options) {
  const images = await readImages(options.image);
  const data = options.analysis
    ? await readJSON(options.analysis)
    : null;
  if (options.analysis) {
    object(data, 'analysis');
    if (Object.hasOwn(data, kind)) {
      object(data[kind], `analysis.${kind}`);
    }
    if (kind === 'room') {
      for (const field of ['furniture', 'objects']) {
        if (Object.hasOwn(data, field)) {
          requireValue(Array.isArray(data[field]),
              `analysis.${field} must be an array`);
          for (const item of data[field]) {
            object(item, `analysis.${field} item`);
          }
        }
      }
    }
    if (kind !== 'room') {
      requireValue(
          !Object.hasOwn(data, 'room'),
          `Expected ${kind} analysis, not room analysis`,
      );
      const other = kind === 'object' ? 'furniture' : 'object';
      requireValue(!Object.hasOwn(data, other),
          `Expected ${kind} analysis, not ${other} analysis`);
    }
  }
  return {images, data};
}
function selected(options, keys) {
  return Object.fromEntries(
      keys
          .filter((k) => options[k] !== undefined)
          .map((k) => [k, options[k]]),
  );
}
/**
 * Reject unsupported keys and forbidden nulls before applying an update.
 * @param {!Object} patch Partial user-supplied attributes.
 * @param {!Array<string>} allowed Keys accepted by this command.
 * @param {!Array<string>} nullable Keys that may be explicitly cleared.
 * @return {void}
 */
function validatePatch(patch, allowed, nullable = []) {
  object(patch, 'update data');
  requireValue(
      Object.keys(patch).every((k) => allowed.includes(k)),
      'Unknown update fields',
      {allowed},
  );
  for (const [key, value] of Object.entries(patch)) {
    requireValue(
        value !== null || nullable.includes(key),
        `${key} cannot be null`,
    );
  }
}
function explicitConfirm(options, keys) {
  for (const key of keys) {
    requireValue(
        Object.hasOwn(options.evidence, key),
        `Unknown confirmation field: ${key}`,
    );
    requireValue(
        options[key] != null,
        `Cannot confirm unknown field: ${key}`,
    );
  }
  confirmed(options, keys);
}

function revisionOptions(command) {
  return command
      .option('--status <status>', 'confirmed|estimated|image|unknown',
          'confirmed')
      .option('--note <text>', 'Basis or assumption for the updated values');
}

function recordUpdate(next, previous, keys, options) {
  requireValue(options.status === 'confirmed' ||
      typeof options.note === 'string' && options.note.trim().length > 0,
  'Estimated updates require --note with their basis or assumption');
  requireValue(options.status === 'confirmed' || !options.confirm?.length,
      'Use a separate --status confirmed update to confirm fields');
  revise(next, previous, keys, options.status,
      options.note ?? 'CLIで入力・確認済み。');
}

cli
    .command('state')
    .description(
        'Return shared project state and required corrections',
    )
    .action(async () => {
      const project = await load(projectPath());
      result({
        project: project,
        corrections: corrections(project),
        validation: validate(project),
      });
    });
cli
    .command('schema')
    .description(
        'Return JSON schema and instructions for the ' +
        'calling AI to analyze images',
    )
    .requiredOption('--kind <kind>', 'room|furniture|object')
    .action((options) => {
      requireValue(
          ['room', 'furniture', 'object'].includes(options.kind),
          'kind must be room, furniture or object',
      );
      result({
        schema: analysisSchema(options.kind),
        prompt: analysisPrompt(options.kind),
      });
    });
const room = cli
    .command('room')
    .description('Create or correct one room');
geometryOptions(room.command('create'))
    .option('--name <name>', 'Room name', '部屋')
    .option('--outline <json>', 'JSON file containing [[x,z],...]')
    .option('--replace', 'Replace existing room')
    .action(async (options) => {
      let outline;
      if (options.outline) {
        outline = await readJSON(options.outline);
      } else {
        requireValue(
            options.width != null && options.depth != null,
            'Specify --width and --depth or --outline',
        );
        number(options.width, 'width', 1, 1e6);
        number(options.depth, 'depth', 1, 1e6);
        outline = [
          [0, 0],
          [options.width, 0],
          [options.width, options.depth],
          [0, options.depth],
        ];
      }
      await changed((project) => {
        requireValue(
            !project.room || options.replace,
            'Room already exists; use --replace',
        );
        project.room = normalizeRoom(
            {
              name: options.name,
              outline,
              height: options.height ?? null,
              openings: [],
            },
            {fallback: 'confirmed', trusted: true},
        );
        return {objectId: project.room.id, room: project.room};
      });
    });
importOptions(room.command('import'))
    .option('--replace', 'Replace existing room')
    .action(async (options) => {
    // Check conflicts before reading the source images and analysis JSON.
      const current = await load(projectPath(), true);
      requireValue(
          !current.room || options.replace,
          'Room already exists; use --replace',
      );
      const {images, data} = await importData('room', options);
      const raw = data?.room ??
          data ?? {
        uncertainties: [
          '画像を保存しました。呼び出し元AIで作成した解析JSONを--analysisで取り込むか、' +
          '実寸で部屋形状・寸法・開口部を補正してください。',
        ],
      };
      const currentRoom = normalizeRoom({...raw, images});
      const furniture = (data?.furniture ?? []).map((item) =>
        normalizeFurniture({...item, images}),
      );
      const objects = (data?.objects ?? []).map((item) =>
        normalizeFurniture({...item, images}),
      );
      await changed((project) => {
        requireValue(
            !project.room || options.replace,
            'Room already exists; use --replace',
        );
        project.room = currentRoom;
        project.furniture.push(...furniture);
        project.objects.push(...objects);
        return {
          objectId: currentRoom.id,
          room: currentRoom,
          addedFurniture: furniture,
          addedObjects: objects,
        };
      });
    });
revisionOptions(geometryOptions(room.command('update')))
    .option('--name <name>')
    .option('--outline <json>')
    .option(
        '--data <json>',
        'Partial room attributes, including openings and ' +
        'uncertainties',
    )
    .option(
        '--confirm <field>',
        'Mark a field checked; repeat',
        repeat,
        [],
    )
    .action(async (options) => {
      const patch = options.data ? await readJSON(options.data) : {};
      validatePatch(
          patch,
          [
            'id',
            'name',
            'outline',
            'height',
            'openings',
            'uncertainties',
          ],
          ['outline', 'height'],
      );
      if (options.outline) {
        patch.outline = await readJSON(options.outline);
      }
      if (
        options.width !== undefined ||
        options.depth !== undefined
      ) {
        requireValue(
            options.width != null && options.depth != null,
            'Rectangle update requires both --width and --depth',
        );
        number(options.width, 'width', 1, 1e6);
        number(options.depth, 'depth', 1, 1e6);
        patch.outline = [
          [0, 0],
          [options.width, 0],
          [options.width, options.depth],
          [0, options.depth],
        ];
      }
      Object.assign(patch, selected(options, ['name', 'height']));
      await changed((project) => {
        const old = needRoom(project);
        requireValue(
            !Object.hasOwn(patch, 'id') || patch.id === old.id,
            'Room ID cannot be changed',
        );
        project.room = normalizeRoom(
            {...old, ...patch},
            {trusted: true},
        );
        recordUpdate(
            project.room,
            old,
            Object.keys(patch).filter((k) =>
              Object.hasOwn(project.room.evidence, k),
            ),
            options,
        );
        if (patch.openings) {
          for (let i = 0; i < patch.openings.length; i++) {
            recordUpdate(
                project.room.openings[i],
                old.openings.find((item) =>
                  item.id === project.room.openings[i].id,
                ) ?? {evidence: {}},
                Object.keys(patch.openings[i]).filter(
                    (k) =>
                      patch.openings[i][k] != null &&
                      Object.hasOwn(project.room.openings[i].evidence, k),
                ),
                options,
            );
          }
        }
        explicitConfirm(project.room, options.confirm);
        return {objectId: project.room.id, room: project.room};
      });
    });
room
    .command('scale')
    .description(
        'Calibrate horizontal room scale using a wall; ' +
        'heights stay unchanged',
    )
    .requiredOption('--wall <index>', 'Wall index', numeric)
    .requiredOption('--length <mm>', 'Measured wall length', numeric)
    .option(
        '--include-furniture',
        'Also scale furniture horizontal dimensions and positions',
    )
    .action(async (options) =>
      changed((project) => {
        const currentRoom = needRoom(project);
        if (options.includeFurniture) {
          requireValue(
              ![...project.furniture, ...project.objects].some((item) =>
                item.parentId || item.supports.length,
              ),
              'Scaling supported scenes requires explicit geometry updates',
          );
        }
        requireValue(
            currentRoom.outline &&
            Number.isInteger(options.wall) &&
            options.wall >= 0 &&
            options.wall < currentRoom.outline.length,
            'Invalid wall',
        );
        number(options.length, 'length', 1, 1e6);
        const a = currentRoom.outline[options.wall];
        const b = currentRoom.outline[
            (options.wall + 1) % currentRoom.outline.length
        ];
        const factor =
          options.length / Math.hypot(b[0] - a[0], b[1] - a[1]);
        currentRoom.outline = currentRoom.outline.map(([x, z]) => [
          x * factor,
          z * factor,
        ]);
        currentRoom.evidence.outline = {
          status: 'estimated',
          note: `壁${options.wall}の実寸${options.length}mmで縮尺補正。他の辺は未確認。`,
        };
        for (const opening of currentRoom.openings) {
          for (const k of ['offset', 'width', 'clearance']) {
            opening[k] *= factor;
            opening.evidence[k] = {
              status: 'estimated',
              note: '部屋の縮尺補正に追従。',
            };
          }
        }
        if (options.includeFurniture) {
          for (const item of project.furniture) {
            for (const k of ['x', 'z', 'width', 'depth']) {
              if (item[k] != null) {
                item[k] *= factor;
                item.evidence[k] = {
                  status: 'estimated',
                  note: '部屋の縮尺補正に追従。',
                };
              }
            }
          }
        }
        return {objectId: currentRoom.id, factor, room: currentRoom};
      }),
    );
const opening = room
    .command('opening')
    .description('Add, update or remove doors/windows');
function openingOptions(command) {
  return command
      .option('--type <type>', 'door|window')
      .option('--wall <index>', 'Room edge index', numeric)
      .option('--offset <mm>', 'Distance from edge start', numeric)
      .option('--width <mm>', 'Opening width', numeric)
      .option('--height <mm>', 'Opening height', numeric)
      .option('--sill <mm>', 'Height above floor', numeric)
      .option('--clearance <mm>', 'Door approach depth', numeric);
}
openingOptions(opening.command('add'))
    .option('--id <id>')
    .action(async (options) =>
      changed((project) => {
        const currentRoom = needRoom(project);
        const next = normalizeRoom(
            {...currentRoom, openings: [...currentRoom.openings, options]},
            {trusted: true},
        );
        const added = next.openings.at(-1);
        confirmed(
            added,
            Object.keys(options).filter((k) =>
              Object.hasOwn(added.evidence, k),
            ),
        );
        project.room = next;
        confirmed(project.room, ['openings']);
        return {objectId: added.id, opening: added};
      }),
    );
revisionOptions(openingOptions(opening.command('update')))
    .requiredOption('--id <id>')
    .option('--confirm <field>', 'Mark checked field', repeat, [])
    .action(async (options) =>
      changed((project) => {
        const currentRoom = needRoom(project);
        const old = currentRoom.openings.find((v) => v.id === options.id);
        if (!old) {
          throw new AppError(
              'OBJECT_NOT_FOUND',
              `Opening not found: ${options.id}`,
          );
        }
        const keys = [
          'type',
          'wall',
          'offset',
          'width',
          'height',
          'sill',
          'clearance',
        ];
        const patch = selected(options, keys);
        project.room = normalizeRoom(
            {
              ...currentRoom,
              openings: currentRoom.openings.map((v) =>
                v.id === options.id ? {...v, ...patch} : v,
              ),
            },
            {trusted: true},
        );
        const updated = project.room.openings.find(
            (v) => v.id === options.id,
        );
        recordUpdate(updated, old, Object.keys(patch), options);
        explicitConfirm(updated, options.confirm);
        return {objectId: options.id, opening: updated};
      }),
    );
opening
    .command('remove')
    .requiredOption('--id <id>')
    .action(async (options) =>
      changed((project) => {
        const currentRoom = needRoom(project);
        requireValue(
            currentRoom.openings.some((v) => v.id === options.id),
            'Opening not found',
        );
        currentRoom.openings = currentRoom.openings.filter(
            (opening) => opening.id !== options.id,
        );
        confirmed(currentRoom, ['openings']);
        return {objectId: options.id, removed: true};
      }),
    );

const furniture = cli
    .command('furniture')
    .description('Create, import and edit furniture');
furnitureOptions(furniture.command('add'))
    .option('--id <id>')
    .option('--data <json>', 'Attributes including support surfaces')
    .action(async (options) => {
      const data = options.data ? await readJSON(options.data) : {};
      object(data, 'furniture data');
      await changed((project) => {
        const item = normalizeFurniture({...data, ...options}, {
          trusted: true,
          fallback: 'confirmed',
        });
        project.furniture.push(item);
        return {objectId: item.id, furniture: item};
      });
    });
importOptions(furniture.command('import')).action(
    async (options) => {
      const {images, data} = await importData('furniture', options);
      const raw = data?.furniture ??
          data ?? {
        uncertainties: [
          '画像からの属性・寸法・形状は未解析です。解析JSONまたは実寸を入力してください。',
        ],
      };
      const item = normalizeFurniture({...raw, images});
      await changed((project) => {
        project.furniture.push(item);
        return {objectId: item.id, furniture: item};
      });
    },
);
revisionOptions(furnitureOptions(furniture.command('update')))
    .requiredOption('--id <id>')
    .option('--data <json>', 'Partial attributes/uncertainties')
    .option('--confirm <field>', 'Mark checked field', repeat, [])
    .action(async (options) => {
      const patch = options.data ? await readJSON(options.data) : {};
      validatePatch(
          patch,
          ['id', ...FURNITURE_FIELDS, 'uncertainties'],
          ['width', 'depth', 'height', 'y', 'parentId', 'surfaceId',
            'wall', 'sourceId'],
      );
      Object.assign(patch, selected(options, FURNITURE_FIELDS));
      await changed((project) => {
        const item = needFurniture(project, options.id);
        requireValue(
            !Object.hasOwn(patch, 'id') || patch.id === item.id,
            'Furniture ID cannot be changed',
        );
        const next = normalizeFurniture(
            {...item, ...patch},
            {trusted: true},
        );
        recordUpdate(
            next,
            item,
            Object.keys(patch).filter((k) =>
              FURNITURE_FIELDS.includes(k),
            ),
            options,
        );
        explicitConfirm(next, options.confirm);
        project.furniture[project.furniture.indexOf(item)] = next;
        return {objectId: next.id, furniture: next};
      });
    });
revisionOptions(furniture.command('move'))
    .requiredOption('--id <id>')
    .option('--x <mm>', 'Center X', numeric)
    .option('--y <mm>', 'Bottom elevation', numeric)
    .option('--z <mm>', 'Center Z', numeric)
    .option('--rotation <degrees>', 'Y rotation', numeric)
    .action(async (options) =>
      changed((project) => {
        const item = needFurniture(project, options.id);
        const patch = selected(options, ['x', 'y', 'z', 'rotation']);
        requireValue(
            Object.keys(patch).length,
            'Specify x, y, z or rotation',
        );
        const previous = structuredClone(item);
        Object.assign(item, patch);
        recordUpdate(item, previous, Object.keys(patch), options);
        return {objectId: item.id, furniture: item};
      }),
    );
furniture
    .command('scale')
    .requiredOption('--id <id>')
    .requiredOption('--dimension <field>', 'width|depth|height')
    .requiredOption('--length <mm>', 'Measured dimension', numeric)
    .action(async (options) =>
      changed((project) => {
        const item = needFurniture(project, options.id);
        requireValue(
            !item.supports.length &&
            ![...project.furniture, ...project.objects].some((child) =>
              child.parentId === item.id,
            ),
            'Scaling a support requires explicit surface and child updates',
        );
        requireValue(
            ['width', 'depth', 'height'].includes(options.dimension) &&
            item[options.dimension] != null,
            'A known reference dimension is required',
        );
        number(options.length, 'length', 1, 1e6);
        const factor = options.length / item[options.dimension];
        for (const k of ['width', 'depth', 'height']) {
          if (item[k] != null) {
            item[k] *= factor;
            item.evidence[k] = {
              status: 'estimated',
              note: '基準寸法で比例補正。比率は未確認。',
            };
          }
        }
        confirmed(item, [options.dimension]);
        return {objectId: item.id, factor, furniture: item};
      }),
    );
furniture
    .command('remove')
    .requiredOption('--id <id>')
    .action(async (options) =>
      changed((project) => {
        needFurniture(project, options.id);
        project.furniture = project.furniture.filter(
            (item) => item.id !== options.id,
        );
        return {objectId: options.id, removed: true};
      }),
    );

const objects = cli.command('object')
    .description('Manage supported small items');
furnitureOptions(objects.command('add'))
    .option('--id <id>')
    .option('--data <json>', 'Object attributes and support relationship')
    .action(async (options) => {
      const data = options.data ? await readJSON(options.data) : {};
      object(data, 'object data');
      await changed((project) => {
        const item = normalizeFurniture({...data, ...options}, {
          trusted: true, fallback: 'confirmed',
        });
        project.objects.push(item);
        return {objectId: item.id, object: item};
      });
    });
importOptions(objects.command('import')).action(async (options) => {
  const {images, data} = await importData('object', options);
  const item = normalizeFurniture({...data?.object ?? data ?? {}, images});
  await changed((project) => {
    project.objects.push(item);
    return {objectId: item.id, object: item};
  });
});
revisionOptions(furnitureOptions(objects.command('update')))
    .requiredOption('--id <id>')
    .option('--data <json>', 'Partial object attributes')
    .option('--confirm <field>', 'Mark checked field', repeat, [])
    .action(async (options) => {
      const patch = options.data ? await readJSON(options.data) : {};
      validatePatch(patch, [...FURNITURE_FIELDS, 'uncertainties'],
          ['width', 'depth', 'height', 'y', 'parentId', 'surfaceId',
            'wall', 'sourceId']);
      Object.assign(patch, selected(options, FURNITURE_FIELDS));
      await changed((project) => {
        const index = project.objects.findIndex(
            (item) => item.id === options.id,
        );
        requireValue(index >= 0, `Object not found: ${options.id}`);
        const next = normalizeFurniture({...project.objects[index], ...patch},
            {trusted: true});
        recordUpdate(next, project.objects[index],
            Object.keys(patch).filter((key) =>
              FURNITURE_FIELDS.includes(key),
            ), options);
        explicitConfirm(next, options.confirm);
        project.objects[index] = next;
        return {objectId: next.id, object: next};
      });
    });
objects.command('remove')
    .requiredOption('--id <id>')
    .action(async (options) => changed((project) => {
      const index = project.objects.findIndex((item) => item.id === options.id);
      requireValue(index >= 0, `Object not found: ${options.id}`);
      project.objects.splice(index, 1);
      return {objectId: options.id, removed: true};
    }));

const layout = cli
    .command('layout')
    .description('Validate, save/load, propose and apply layouts');
layout
    .command('validate')
    .option('--json', 'JSON output')
    .option('--strict', 'Exit 2 when any value requires confirmation')
    .action(async (options) => {
      const report = validate(await load(projectPath()));
      result({validation: report});
      if (
        !report.geometryValid ||
        (options.strict && !report.valid)
      ) {
        process.exitCode = 2;
      }
    });
layout
    .command('save')
    .requiredOption('--output <path>')
    .action(async (options) => {
      await saveCopy(projectPath(), options.output);
      result({output: path.resolve(options.output)});
    });
layout
    .command('load')
    .requiredOption('--input <path>')
    .action(async (options) => {
      // Replacing a project must not require its existing contents to be valid.
      const project = await saveCopy(options.input, projectPath());
      result({project, keepProposals: true, corrections: corrections(project)});
    });
layout
    .command('propose')
    .option('--preference <text>', 'Requested goal', '通路を広く')
    .option('--count <number>', '1–3 proposals', numeric, 3)
    .option('--step <mm>', 'Grid step', numeric, 200)
    .option(
        '--clearance <mm>',
        'Desired gap between furniture',
        numeric,
        400,
    )
    .action(async (options) =>
      changed((project) => {
        requireValue(
            Number.isInteger(options.count) &&
            options.count >= 1 &&
            options.count <= 3,
            'count must be 1–3',
        );
        number(options.step, 'step', 50, 5000);
        number(options.clearance, 'clearance', 0, 5000);
        const proposals = propose(project, options);
        project.proposals = proposals.map(({validation, ...v}) => v);
        return {proposals, keepProposals: true};
      }),
    );
layout
    .command('apply')
    .requiredOption('--id <id>', 'Proposal ID')
    .action(async (options) =>
      changed((project) => {
        const v = project.proposals.find((v) => v.id === options.id);
        requireValue(v, 'Proposal not found');
        const next = applyPlacements(project, v.placements);
        const report = validate(next);
        requireValue(
            report.geometryValid,
            'Proposal contains geometry problems',
            report.issues,
        );
        project.furniture = next.furniture;
        for (const item of project.furniture) {
          for (const k of ['x', 'z', 'rotation']) {
            item.evidence[k] = {
              status: 'estimated',
              note: '配置案の適用。実位置は未確認。',
            };
          }
        }
        return {objectId: v.id, applied: true};
      }),
    );
cli
    .command('export')
    .option('--format <format>', 'html|json', 'html')
    .requiredOption('--output <path>')
    .action(async (options) => {
      requireValue(
          ['html', 'json'].includes(options.format),
          'format must be html or json',
      );
      requireValue(
          options.format === 'json' ||
          !(await sameFile(options.output, projectPath())),
          'HTML output cannot overwrite project JSON',
      );
      let project;
      if (options.format === 'html') {
        project = await load(projectPath());
        await exportHTML(project, options.output);
      } else {
        project = await saveCopy(projectPath(), options.output);
      }
      result({
        output: path.resolve(options.output),
        validation: validate(project),
      });
    });

try {
  await cli.parseAsync();
} catch (e) {
  if (
    e.code === 'commander.helpDisplayed' ||
    e.code === 'commander.version'
  ) {
    process.exitCode = 0;
  } else {
    process.stderr.write(
        JSON.stringify({
          ok: false,
          error: {
            code: e.code ?? 'INTERNAL_ERROR',
            message: e.message,
            ...(e.details !== undefined ? {details: e.details} : {}),
          },
        }) + '\n',
    );
    process.exitCode = 1;
  }
}
