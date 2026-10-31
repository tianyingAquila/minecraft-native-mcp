export function unwrap(result) {
  let value = result.structuredContent;
  if (!value) {
    for (const c of result.content || []) {
      if (c.type === "text") {
        try {
          value = JSON.parse(c.text);
          break;
        } catch {}
      }
    }
  }
  value ??= result;
  return value.response?.format === "json"
    ? {
        ...value.response.data,
        foreground: value.foreground,
        notifications: value.notifications,
      }
    : value;
}
