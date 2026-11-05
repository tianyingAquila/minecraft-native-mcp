// Copied from mrubens/jevcraft @ 5f30921438b9c21be8f838bd0f60c191cf0877d4.
// Copyright (c) 2026 Matt Rubens. MIT; licenses/jevcraft-MIT.txt.
// Only the independent numeric progress primitive is vendored.
function advance(record, value, { better = 'lower', epsilon = 0.5, now = Date.now() } = {}) {
  const improved = !Number.isFinite(record.best) ||
    (better === 'lower' ? value < record.best - epsilon : value > record.best + epsilon);
  if (improved) { record.best = value; record.looks = 0; record.bestAt = now; }
  else record.looks = (record.looks || 0) + 1;
  return !improved;
}

export {advance};
