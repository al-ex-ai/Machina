// FlightGear animation curves, shared by scripts/fg-pose.js (baking a pose) and the app (playing it).

/**
 * The animated value at property value v: interpolation table, or factor and offset, then clamps.
 * @param {{ table?: number[][], factor?: number, offset?: number, min?: number, max?: number, sign?: number }} c
 */
export function curveAt(c, v) {
  let val;
  if (c.table) {
    const e = c.table;
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
