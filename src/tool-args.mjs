// Tolerate JSON numeric strings only where the published tool schema expects a number.
// Empty strings, booleans, objects and unknown properties retain their original types.
export function normalizeToolArgs(value, schema = {}) {
  if (['number', 'integer'].includes(schema.type) && typeof value === 'string') {
    const text = value.trim();
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text) && Number.isFinite(Number(text))) return Number(text);
  }
  if (schema.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeToolArgs(item, schema.properties?.[key])]));
  }
  if (schema.type === 'array' && Array.isArray(value)) return value.map(item => normalizeToolArgs(item, schema.items));
  return value;
}
