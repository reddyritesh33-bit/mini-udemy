// Small input checks shared by the Route Handlers. The database constraints are the final word;
// these only turn obviously bad input into a clear 400 instead of a database error.

export function parseId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function cleanText(value, maxLength) {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length > 0 && t.length <= maxLength ? t : null;
}
