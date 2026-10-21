/** Build a closed hull below an ordered deck rim, keeping every deck joint fixed.
 * @param {{x:number,y:number,z:number}[]} rim
 * @param {number} bottomY Model-local keel height.
 */
export function closedHull(rim, bottomY) {
  const count = rim.length;
  if (count < 3) throw new Error("A hull needs at least three deck rim points");
  const cx = rim.reduce((sum, p) => sum + p.x, 0) / count;
  const cz = rim.reduce((sum, p) => sum + p.z, 0) / count;
  const vertices = rim.flatMap(p => [p.x, p.y, p.z]);
  for (const p of rim) vertices.push(cx + (p.x - cx) * 0.8, bottomY, cz + (p.z - cz) * 0.94);
  vertices.push(cx, Math.min(...rim.map(p => p.y)), cz, cx, bottomY, cz);
  const indices = [];
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    indices.push(i, j, count + j, i, count + j, count + i);
    indices.push(count * 2, j, i);
    indices.push(count * 2 + 1, count + i, count + j);
  }
  return { vertices, indices };
}
