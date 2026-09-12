/**
 * @haverstack/eleventy — URL string helpers
 * -------------------------------------------------------
 * Both trims below deliberately avoid a backtracking regex
 * (`/\/+$/`, `/^\/+|\/+$/g`): unanchored-start quantified patterns like
 * these are quadratic on adversarial input — many slashes abutting a
 * non-slash forces the engine to retry the match at every start position.
 * The inputs cross a trust boundary a malicious stack writer or site
 * config could reach (`baseUrl` is record content; `assetDir` is a
 * plugin option), so this is a real build-time DoS, not a theoretical one.
 */

export function stripTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47 /* '/' */) end--;
  return s.slice(0, end);
}

export function trimSlashes(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && s.charCodeAt(start) === 47 /* '/' */) start++;
  while (end > start && s.charCodeAt(end - 1) === 47 /* '/' */) end--;
  return s.slice(start, end);
}
