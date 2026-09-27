import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const scene = await readJson('assets/route/jingguang/zhuzhou-13877-scene.json');
const path = await readJson('assets/route/jingguang/zhuzhou-1-southbound-path.json');
const signal = await readJson('assets/route/jingguang/chuzhan-signal.json');
const texture = await readFile('assets/route/jingguang/textures/Sign.png');

assert.equal(signal.format, 'msts-signal-asset-v1');
assert.equal(signal.source.fileName, 'chuzhan.s');
assert.equal(signal.source.sha256, '69F3DBFAADBAC175E77311200B8904F1E78AED3179B1AB5291890C7E851B93D1');
assert.equal(signal.source.subObjectMask, 1);
assert.equal(signal.summary.sourceSubObjectCount, 1);
assert.deepEqual(signal.summary.selectedSubObjects, [0]);
assert.equal(signal.summary.triangleCount, 320);
assert.equal(signal.groups.length, 2);
assert(signal.groups.every((group) => group.positions.length > 0));
assert(signal.materials.every((material) => material.texture === 'Sign.png'));
assert.equal(createHash('sha256').update(texture).digest('hex').toUpperCase(), '29BE8A906D25617735DA2562A3E59FE3232F0ABD2551FF0A32FD8DCB22525AE2');

const selected = new Map(scene.instances.filter((item) => item.uid === 172 || item.uid === 173).map((item) => [item.uid, item]));
assert.equal(selected.size, 2);
for (const uid of [172, 173]) {
  assert.equal(selected.get(uid).type, 'SignalObj');
  assert.equal(selected.get(uid).shape, 'chuzhan.s');
}
assert.deepEqual(selected.get(172).position, [16.37, -0.038, -618.15]);
assert.deepEqual(selected.get(173).position, [21.65, -0.038, -618.4]);

const points = [];
for (let index = 0; index < path.positions.length; index += 3) points.push(path.positions.slice(index, index + 3));
const distances = [0];
for (let index = 1; index < points.length; index += 1) {
  const [ax, ay, az] = points[index - 1];
  const [bx, by, bz] = points[index];
  distances.push(distances[index - 1] + Math.hypot(bx - ax, by - ay, bz - az));
}

function projectToPath(position) {
  let best = null;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const segment = end.map((value, axis) => value - start[axis]);
    const lengthSq = segment.reduce((sum, value) => sum + value * value, 0);
    if (lengthSq < 1e-6) continue;
    const relative = position.map((value, axis) => value - start[axis]);
    const ratio = Math.max(0, Math.min(1, relative.reduce((sum, value, axis) => sum + value * segment[axis], 0) / lengthSq));
    const closest = start.map((value, axis) => value + segment[axis] * ratio);
    const offset = position.map((value, axis) => value - closest[axis]);
    const lateralDistance = Math.hypot(...offset);
    const horizontalLength = Math.hypot(segment[0], segment[2]);
    const right = [segment[2] / horizontalLength, 0, -segment[0] / horizontalLength];
    if (!best || lateralDistance < best.lateralDistance) {
      best = {
        alongDistance: distances[index - 1] + Math.sqrt(lengthSq) * ratio,
        lateralDistance,
        signedLateral: offset.reduce((sum, value, axis) => sum + value * right[axis], 0),
      };
    }
  }
  return best;
}

const departure = projectToPath(selected.get(172).position);
const neighbor = projectToPath(selected.get(173).position);
assert(Math.abs(departure.alongDistance - 571.53) < 0.1);
assert(Math.abs(neighbor.alongDistance - 571.87) < 0.1);
assert(departure.signedLateral < -4 && departure.signedLateral > -5.2);
assert(neighbor.signedLateral < -9.2 && neighbor.signedLateral > -10.6);
assert(neighbor.signedLateral < departure.signedLateral);

console.log(`Signal assets valid: UID 172 at ${departure.alongDistance.toFixed(2)} m, UID 173 at ${neighbor.alongDistance.toFixed(2)} m.`);
