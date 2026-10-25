import {readFile, writeFile, rename, unlink, mkdir, open, realpath} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {emptyProject, normalizeProject, id} from './model.js';

/**
 * Read and parse a local UTF-8 JSON file.
 * @param {string} file Source path.
 * @return {!Promise<*>} Parsed JSON value.
 * @throws {AppError} FILE_NOT_FOUND or INVALID_JSON on read/parse failure.
 */
export async function readJSON(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new AppError(
        error.code === 'ENOENT' ? 'FILE_NOT_FOUND' : 'INVALID_JSON',
        `Cannot read JSON: ${file}`,
        error.message,
    );
  }
}
/**
 * Load validated state; only a missing file may yield a new empty project.
 * @param {string} file Project JSON path.
 * @param {boolean} create Whether a missing file may start an empty project.
 * @return {!Promise<!Object>} Normalized project with lengths in mm.
 */
export async function load(file, create = false) {
  try {
    return normalizeProject(await readJSON(file));
  } catch (error) {
    if (create && error.code === 'FILE_NOT_FOUND') {
      return emptyProject();
    }
    throw error;
  }
}
/**
 * Replace a destination through a temporary file in the same directory.
 * @param {string} file Destination path; parent directories are created.
 * @param {string} content Complete file content.
 * @return {!Promise<void>} Resolves after replacement and temporary cleanup.
 */
export async function atomicWrite(file, content) {
  const target = path.resolve(file);
  await mkdir(path.dirname(target), {recursive: true});
  const temp = `${target}.${randomUUID()}.write.tmp`;
  try {
    await writeFile(temp, content, {flag: 'wx'});
    await rename(temp, target);
  } finally {
    await unlink(temp).catch(() => {});
  }
}
async function canonicalPath(file) {
  try {
    return await realpath(file);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return path.resolve(file);
    }
    throw error;
  }
}
/**
 * Compare canonical paths, accounting for Windows case-insensitive paths.
 * @param {string} a First path; it need not exist yet.
 * @param {string} b Second path; it need not exist yet.
 * @return {!Promise<boolean>} Whether the resolved paths denote one file.
 */
export async function sameFile(a, b) {
  const paths = await Promise.all([
    canonicalPath(a),
    canonicalPath(b),
  ]);
  return process.platform === 'win32'
    ? paths[0].toLowerCase() === paths[1].toLowerCase()
    : paths[0] === paths[1];
}
/**
 * Run an action while holding an exclusive lock beside the canonical file.
 * @param {string} file Destination whose lock is acquired before reading.
 * @param {function(string): *} action Receives the canonical destination path.
 * @return {!Promise<*>} The awaited action result; the lock is then removed.
 * @throws {AppError} PROJECT_BUSY if another writer holds the lock.
 */
export async function withFileLock(file, action) {
  const target = await canonicalPath(file);
  await mkdir(path.dirname(target), {recursive: true});
  const lock = `${target}.lock.tmp`;
  let handle;
  try {
    handle = await open(lock, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new AppError(
          'PROJECT_BUSY',
          'Another process is editing this project. If it ' +
          'crashed, remove the .lock.tmp file.',
      );
    }
    throw error;
  }
  try {
    return await action(target);
  } finally {
    await handle.close();
    await unlink(lock);
  }
}
/**
 * Load, edit, validate and atomically save a project under one file lock.
 * @param {string} file Project JSON path; missing files start empty.
 * @param {function(!Object): *} action Callback that mutates project state.
 * @return {!Promise<*>} Callback result after the validated write succeeds.
 */
export async function mutate(file, action) {
  return withFileLock(file, async (target) => {
    const project = await load(target, true);
    project.projectId ??= id('project');
    const result = await action(project);
    await atomicWrite(
        target,
        JSON.stringify(normalizeProject(project), null, 2) + '\n',
    );
    return result;
  });
}
/**
 * Save validated project data while locking the destination before reading.
 * @param {string} input Existing source project JSON path.
 * @param {string} output Destination path, which may refer to the input.
 * @return {!Promise<!Object>} The normalized project that was written.
 */
export async function saveCopy(input, output) {
  // Lock before reading: input and output may refer to the same project.
  return withFileLock(output, async (target) => {
    const project = await load(input);
    project.projectId ??= id('project');
    await atomicWrite(
        target,
        JSON.stringify(project, null, 2) + '\n',
    );
    return project;
  });
}
