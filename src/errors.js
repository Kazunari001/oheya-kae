/**
 * An application failure exposed through the CLI JSON error contract.
 */
export class AppError extends Error {
  /**
   * @param {string} code Stable machine-readable error code.
   * @param {string} message Human-readable explanation.
   * @param {*} details Optional context included in the error response.
   */
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}
/**
 * Reject invalid caller data before state is changed.
 * @param {*} condition A truthy value means the requirement is satisfied.
 * @param {string} message Explanation of the rejected value.
 * @param {*} details Optional context for the caller.
 * @return {void}
 * @throws {AppError} INVALID_DATA when the condition is falsy.
 */
export function requireValue(condition, message, details) {
  if (!condition) {
    throw new AppError('INVALID_DATA', message, details);
  }
}
