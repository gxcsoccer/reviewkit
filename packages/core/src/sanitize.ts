/**
 * Untrusted-data helpers (PRD 12.9, 20: agent-provided text, markdown, links and
 * field values are never executed as HTML or script).
 *
 * The React package renders everything through text nodes, so escaping is not the
 * concern here — links are. `sanitizeUrl` is the single gate every href passes.
 */

const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

/** C0/C1 controls, zero-width characters and bidi overrides. */
const CONTROL_CHARS_SOURCE = '[\\u0000-\\u001F\\u007F-\\u009F\\u200B-\\u200F\\u202A-\\u202E\\u2060\\uFEFF]';
// Separate instances: a `g` regex shares `lastIndex` between `.test()` calls.
const CONTROL_CHARS_TEST = new RegExp(CONTROL_CHARS_SOURCE);
const CONTROL_CHARS_REPLACE = new RegExp(CONTROL_CHARS_SOURCE, 'g');

/**
 * Returns a safe absolute URL, a safe host-relative path, or `undefined`.
 *
 * Rejected: `javascript:`, `data:`, `vbscript:`, `file:`, protocol-relative
 * `//evil.example`, anything containing control characters, and unparseable input.
 */
export function sanitizeUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim();
  if (value === '' || CONTROL_CHARS_TEST.test(value)) return undefined;

  // Host-relative links are allowed so evidence can point at the host app itself,
  // but protocol-relative URLs are not: they escape the origin.
  if (value.startsWith('/') && !value.startsWith('//')) return value;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  if (!SAFE_SCHEMES.has(parsed.protocol.toLowerCase())) return undefined;
  return parsed.toString();
}

/** Strip control characters and zero-width tricks from text destined for the DOM. */
export function sanitizeText(raw: unknown, maxLength = 20_000): string {
  if (raw === null || raw === undefined) return '';
  const text = typeof raw === 'string' ? raw : String(raw);
  const cleaned = text.replace(CONTROL_CHARS_REPLACE, (match) =>
    match === '\n' || match === '\t' || match === '\r' ? match : '',
  );
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}…` : cleaned;
}

/** Human-readable one-line form of any JSON value, for cells and inline diffs. */
export function formatValue(value: unknown, maxLength = 240): string {
  if (value === undefined) return '';
  if (value === null) return 'null';
  if (typeof value === 'string') return sanitizeText(value, maxLength);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const json = JSON.stringify(value);
  const text = json === undefined ? String(value) : json;
  return sanitizeText(text, maxLength);
}
