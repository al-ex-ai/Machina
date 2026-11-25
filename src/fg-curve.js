// FlightGear animation curves, shared by scripts/fg-pose.js (baking a pose) and the app (playing it).

/**
 * The animated value at property value v: interpolation table, or factor and offset, then clamps.
 * @param {{ table?: number[][], factor?: number, offset?: number, min?: number, max?: number, sign?: number }} c
 */
const sorted = new WeakMap();
const sortedTable = t => { if (!sorted.has(t)) sorted.set(t, [...t].sort((a, b) => a[0] - b[0])); return sorted.get(t); };

export function curveAt(c, v) {
  let val;
  if (c.fixed !== undefined) val = c.fixed;
  else if (c.expr) val = evalExpr(c.expr, v);
  else if (c.table) {
    // FlightGear reads a table in either order (the Yak-40's rudder runs from 1 down to -1).
    const e = c.table.length > 1 && c.table[0][0] > c.table.at(-1)[0] ? sortedTable(c.table) : c.table;
    if (v <= e[0][0]) val = e[0][1];
    else if (v >= e.at(-1)[0]) val = e.at(-1)[1];
    else for (let i = 0; i < e.length - 1; i++) if (v <= e[i + 1][0]) { const f = (v - e[i][0]) / (e[i + 1][0] - e[i][0]); val = e[i][1] + (e[i + 1][1] - e[i][1]) * f; break; }
  } else {
    val = v * (c.factor ?? 1) + (c.offset ?? 0);
    if (c.min !== undefined) val = Math.max(c.min, val);
    if (c.max !== undefined) val = Math.min(c.max, val);
  }
  return val * (c.sign ?? 1);
}

/**
 * A FlightGear select condition from scripts/fg-pose.js: ['and' | 'or' | 'not', ...], [comparison, property,
 * value] with gt, lt, ge, le, eq, or ['prop', property] for a flag. Properties the app does not play (seat
 * switches, multiplayer flags) are false; gear positions default to down, compressions to 0.
 * @param {any} c @param {Record<string, number>} values
 */
export function conditionAt(c, values) {
  const val = p => values[p] ?? (/position-norm$/.test(p) ? 1 : /compression-norm$/.test(p) ? 0 : NaN);
  switch (c[0]) {
    case 'and': return c.slice(1).every(x => conditionAt(x, values));
    case 'or': return c.slice(1).some(x => conditionAt(x, values));
    case 'not': return !conditionAt(c[1], values);
    case 'prop': return Boolean(values[c[1]]);
    case 'const': return c[1];
    case 'gt': return val(c[1]) > c[2];
    case 'lt': return val(c[1]) < c[2];
    case 'ge': return val(c[1]) >= c[2];
    case 'le': return val(c[1]) <= c[2];
    case 'eq': return Math.abs(val(c[1]) - c[2]) < 1e-6;
    default: return true;
  }
}

/** A FlightGear expression tree from scripts/fg-pose.js: 'p' is the property, numbers are constants. */
function evalExpr(e, v) {
  if (e === 'p') return v;
  if (typeof e === 'number') return e;
  const [op, ...a] = e, x = a.map(n => evalExpr(n, v));
  switch (op) {
    case 'sum': return x.reduce((s, y) => s + y, 0);
    case 'difference': case 'dif': return x.slice(1).reduce((s, y) => s - y, x[0]);
    case 'prod': case 'product': return x.reduce((s, y) => s * y, 1);
    case 'div': return x[0] / x[1];
    case 'max': return Math.max(...x);
    case 'min': return Math.min(...x);
    case 'abs': return Math.abs(x[0]);
    case 'neg': return -x[0];
    case 'clip': return Math.min(Math.max(x[0], x[1] ?? -Infinity), x[2] ?? Infinity);
    case 'sin': return Math.sin(x[0]);
    case 'cos': return Math.cos(x[0]);
    case 'deg2rad': return (x[0] * Math.PI) / 180;
    case 'rad2deg': return (x[0] * 180) / Math.PI;
    default: return x[0] ?? 0;
  }
}
