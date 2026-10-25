import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {AppError} from './errors.js';
import {atomicWrite, withFileLock} from './store.js';
import {validate, applyPlacements} from './validation.js';
import {imageHash} from './detections.js';
import {exportRevision} from './revisions.js';

/**
 * Serialize a JSON-compatible value for an HTML script element.
 * @param {*} value JSON-compatible project or report data.
 * @return {string} JSON with script-terminating characters escaped.
 */
export const safeJSON = (value) =>
  JSON.stringify(value)
      .replace(/</g, '\\u003c')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
/**
 * Write an offline HTML viewer using the built bundle and project data.
 * Replace markers only in the original template, never in inserted data.
 * @param {!Object} project Normalized project with lengths in mm.
 * @param {string} output Destination HTML path.
 * @param {!Object} options Source project path and processing stage.
 * @return {!Promise<string>} Absolute application root directory.
 * @throws {AppError} If the bundle is missing or the destination is locked.
 */
export async function exportHTML(project, output, options = {}) {
  const root = new URL('../', import.meta.url);
  let script;
  let license;
  try {
    [script, license] = await Promise.all([
      readFile(new URL('dist/viewer.js', root), 'utf8'),
      readFile(new URL('dist/THREE-LICENSE.txt', root), 'utf8'),
    ]);
  } catch {
    throw new AppError(
        'VIEWER_NOT_BUILT',
        'Run npm run build before exporting HTML.',
    );
  }
  const template = await readFile(
      new URL('viewer/index.html', root),
      'utf8',
  );
  const styles = await readFile(new URL('viewer/viewer.css', root), 'utf8');
  const payload = {
    revision: exportRevision(project, options),
    project: project,
    validation: validate(project),
    proposals: project.proposals.map((value) => ({
      ...value,
      validation: validate(
          applyPlacements(project, value.placements),
      ),
    })),
    sourceIndexes: Object.fromEntries((project.analysis?.sources ?? []).map(
        (source) => {
          const images = [...[project.room, ...project.furniture,
            ...(project.objects ?? [])].filter(Boolean)
              .flatMap((item) => item.images ?? []),
          ...(project.analysis?.images ?? [])];
          const unique = [...new Map(images.map((image) =>
            [image.data, image],
          )).values()];
          return [source.id, unique.findIndex((image) =>
            imageHash(image) === source.sha256,
          )];
        },
    )),
  };
  const escapedLicense = license
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  const replacements = {
    '<link rel="stylesheet" href="./viewer.css">':
        `<style>\n${styles.replace(/<\/style/gi, '<\\/style')}</style>`,
    '/*OHEYA_KAE_DATA*/': safeJSON(payload),
    '/*OHEYA_KAE_SCRIPT*/': script.replace(
        /<\/script/gi,
        '<\\/script',
    ),
    '</details>':
      '<pre class="license-text">' +
      `${escapedLicense}` +
      '</pre></details>',
  };
  // Replace only markers in the original template, never text inside inserted
  // data.
  const placeholders = new RegExp(
      '/\\*OHEYA_KAE_(?:DATA|SCRIPT)\\*/|</details>|' +
      '<link rel="stylesheet" href="\\./viewer\\.css">',
      'g',
  );
  const html = template.replace(
      placeholders,
      (marker) => replacements[marker],
  );
  await withFileLock(output, (target) => atomicWrite(target, html));
  return fileURLToPath(root);
}
