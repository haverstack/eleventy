/**
 * @haverstack/eleventy — build errors
 * -------------------------------------------------------
 * One error type for every structural fault that fails a build: an
 * unresolvable site, a path collision, conflicting sidecars. The `check`
 * command catches these to report them without emitting; a plain build
 * lets them throw.
 */

export class HaverstackEleventyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HaverstackEleventyError';
  }
}
