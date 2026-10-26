/** Decode a captured resource for inspection without changing its contents. */
export function decodeFullResource(encoded: string): Record<string, unknown> {
  let value: unknown;
  try {
    const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error('The captured resource is not valid base64-encoded JSON.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The captured resource must be a JSON object.');
  }
  return value as Record<string, unknown>;
}
