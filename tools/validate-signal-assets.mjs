import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const scene = await readJson('assets/msts-neiyi-corridor/neiyi-neijiang-neijiangnan-scene.json');
const path = await readJson('assets/msts-neiyi/neiyi-5635-trackdb-path.json');
const signal = scene.shapes['chuzhan-halfauto-zhuci.s'];
const runtimeSource = await readFile('scripts/mstsRouteScene.js', 'utf8');

assert(signal, '内宜线出站信号机模型不存在');
assert.equal(signal.fileName, 'chuzhan-halfauto-zhuci.s');
assert.equal(signal.groups.length, 2);
assert(signal.groups.every((group) => group.positions.length > 0));
assert(signal.materials.every((material) => material.texture.toLowerCase() === 'sign.png'));

for (const assetPath of [
  '../assets/msts-neiyi-corridor/neiyi-neijiang-neijiangnan-scene.json',
  '../assets/msts-neiyi/neiyi-5635-trackdb-path.json',
  '../assets/msts-neiyi-corridor/textures/',
]) {
  assert(runtimeSource.includes(`new URL('${assetPath}', import.meta.url).href`), `Pages-safe URL missing for ${assetPath}`);
}
const pagesModuleUrl = new URL('https://tanhaoyu646-bit.github.io/hxd1c-running-credential-confirmation/scripts/mstsRouteScene.js');
assert.equal(
  new URL('../assets/msts-neiyi-corridor/neiyi-neijiang-neijiangnan-scene.json', pagesModuleUrl).href,
  'https://tanhaoyu646-bit.github.io/hxd1c-running-credential-confirmation/assets/msts-neiyi-corridor/neiyi-neijiang-neijiangnan-scene.json',
);

const selected = scene.instances.filter((item) => item.uid === 52244 || item.uid === 52245);
assert(selected.some((item) => item.uid === 52244));
assert(selected.some((item) => item.uid === 52245));
for (const item of selected) {
  assert.equal(item.type, 'SignalObj');
  assert.equal(item.shape, 'chuzhan-halfauto-zhuci.s');
}

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

const departure = projectToPath(selected.find((item) => item.uid === 52244).position);
const neighbor = projectToPath(selected.filter((item) => item.uid === 52245).sort((a, b) => Math.abs(projectToPath(a.position).alongDistance - 459.44) - Math.abs(projectToPath(b.position).alongDistance - 459.44))[0].position);
assert(Math.abs(departure.alongDistance - 454.14) < 0.1);
assert(Math.abs(neighbor.alongDistance - 459.44) < 0.1);
assert(departure.signedLateral > 2 && departure.signedLateral < 3);
assert(neighbor.signedLateral > 7 && neighbor.signedLateral < 9);
assert(neighbor.alongDistance > departure.alongDistance);

console.log(`Signal assets valid: UID 52244 at ${departure.alongDistance.toFixed(2)} m, UID 52245 at ${neighbor.alongDistance.toFixed(2)} m.`);
