import test from "node:test";
import assert from "node:assert/strict";
import { closedHull } from "./naval-hull.mjs";
const rim = [ {x:-2,y:2,z:8}, {x:-3,y:2.2,z:-3}, {x:0,y:2.5,z:-10}, {x:3,y:2.2,z:-3}, {x:2,y:2,z:8} ];
test("closed naval hull keeps the deck seam fixed and reaches the keel", () => {
  const mesh = closedHull(rim, -1.5);
  assert.deepEqual(mesh.vertices.slice(0, rim.length * 3), rim.flatMap(p => [p.x,p.y,p.z]));
  for (let i=0;i<rim.length;i++) assert.equal(mesh.vertices[(i+rim.length)*3+1], -1.5);
});
test("naval hull has no open edges, including its stern and bottom", () => {
  const { vertices, indices } = closedHull(rim, -1.5);
  const edges = new Map();
  for (let i=0;i<indices.length;i+=3) {
    const points = indices.slice(i,i+3).map(id => vertices.slice(id*3,id*3+3));
    const a=points[1].map((v,j)=>v-points[0][j]), b=points[2].map((v,j)=>v-points[0][j]);
    assert.ok(Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])>0);
    for (let j=0;j<3;j++) { const edge=[indices[i+j],indices[i+(j+1)%3]].sort((a,b)=>a-b).join(","); edges.set(edge,(edges.get(edge)??0)+1); }
  }
  assert.ok([...edges.values()].every(count=>count===2));
});
