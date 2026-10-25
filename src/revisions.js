import {createHash} from 'node:crypto';
import path from 'node:path';
import {requireValue} from './errors.js';

/**
 * Hash JSON data independently of object key order, retaining array order.
 * @param {*} value JSON-compatible data.
 * @return {string} SHA-256 of the canonical JSON representation.
 */
export function revisionHash(value) {
  const serialized = JSON.stringify(value, (_key, entry) =>
    entry && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(Object.keys(entry).sort()
          .map((key) => [key, entry[key]])) : entry);
  return createHash('sha256').update(serialized).digest('hex');
}

/**
 * Describe an immutable HTML snapshot without editing the source project.
 * @param {!Object} project Normalized project.
 * @param {!Object} options Source path and user-declared processing stage.
 * @return {!Object} Identifiers and hashes embedded in the offline HTML.
 */
export function exportRevision(
    project, {sourcePath = null, stage = 'snapshot'} = {},
) {
  requireValue(['snapshot', 'raw', 'corrected', 'estimated'].includes(stage),
      'stage must be snapshot, raw, corrected or estimated');
  const projectRevision = revisionHash(project);
  const fallbackId = project.room?.id ??
      revisionHash(project.furniture.map((item) => item.id)).slice(0, 16);
  return {
    projectId: project.projectId ?? `legacy-${fallbackId}`,
    projectRevision,
    sourceProject: sourcePath == null ? null : path.resolve(sourcePath),
    analysisRevision: project.analysis ? revisionHash(project.analysis) : null,
    analysisRuns: (project.analysis?.runs ?? []).map(revisionHash),
    exportedAt: new Date().toISOString(),
    stage,
  };
}
