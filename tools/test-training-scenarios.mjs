import assert from 'node:assert/strict';
import { TrainSimulation } from '../scripts/dynamics.js';
import { LKJ_TRAINING_PARAMETERS } from '../scripts/scenario.js';
import { ROUTE_CONTEXT, getScenario } from '../scripts/credentialScenario.js';
import { PROCEDURE, procedureState, scoreRun } from '../scripts/procedure.js';

const INITIAL_KEYS = ['traction', 'direction', 'autoBrake', 'independentBrake', 'parkingBrake', 'panto', 'mainBreaker', 'compressor'];

function prepare(id, mode = 'teaching') {
  const sim = new TrainSimulation();
  if (mode === 'assessment') assert.equal(sim.command('training-mode', mode), true);
  assert.equal(sim.command('scenario-select', id), true);
  for (const key of INITIAL_KEYS) assert.equal(sim.command('initial-inspect', key), true);
  assert.equal(sim.command('initial-confirm'), true);
  assert.equal(sim.command('lkj-confirm', LKJ_TRAINING_PARAMETERS), true);
  assert.equal(sim.command('panto', true), true);
  for (let index = 0; index < 300; index += 1) sim.tick(0.05);
  assert.equal(sim.command('main-breaker', true), true);
  assert.equal(sim.command('compressor', true), true);
  assert.equal(sim.command('auto-brake', 1), true);
  for (let index = 0; index < 100; index += 1) sim.tick(0.05);
  assert.equal(sim.command('auto-brake', 0), true);
  for (let index = 0; index < 400; index += 1) sim.tick(0.05);
  assert.equal(sim.command('parking-release'), true);
  return sim;
}

function authorize(sim, id) {
  if (id === 'normal') {
    assert.equal(sim.command('station-contact'), true);
    assert.equal(sim.command('signal-answer', 'green'), true);
    assert.equal(sim.command('direction-answer', 'qidouchong'), true);
  } else if (id === 'weather') {
    assert.equal(sim.command('order-sign'), true);
    assert.equal(sim.command('locomotive-signal-answer', 'green'), true);
    assert.equal(sim.command('weather-report'), true);
  } else {
    if (id === 'greenPermit') assert.equal(sim.command('station-contact'), true);
    else assert.equal(sim.command('order-sign'), true);
    assert.equal(sim.command('credential-open'), true);
    assert.equal(sim.command('credential-submit', true), true);
    const scenario = getScenario(id);
    assert.equal(sim.command('lkj-special-unlock', scenario.lkjUnlockCode), true);
    assert.equal(sim.command('departure-notice'), true);
  }
  assert.equal(sim.command('hand-signal-confirm'), true);
  assert.equal(sim.command('headlight'), true);
  assert.equal(sim.command('horn'), true);
  assert.equal(sim.command('direction', 'F'), true);
  assert.equal(sim.command('traction', 1), true);
}

function runScenario(id) {
  const sim = prepare(id);
  authorize(sim, id);
  let lkjStartPressed = false;
  let weatherSignalConfirmed = false;
  for (let index = 0; index < 200000 && !sim.state.completed; index += 1) {
    sim.tick(0.05);
    if (id === 'weather' && !weatherSignalConfirmed && sim.state.credentialStage === 'confirm-ground-signal') {
      assert.equal(sim.command('signal-answer', 'green'), true);
      weatherSignalConfirmed = true;
    }
    if (!lkjStartPressed && sim.state.speed >= 1 && Math.abs(sim.state.distance - ROUTE_CONTEXT.departureSignalDistance) < 5) {
      assert.equal(sim.command('lkj-start'), true);
      lkjStartPressed = true;
    }
  }
  assert.equal(sim.state.completed, true, `${id}未完成训练终点`);
  assert.equal(sim.state.lkjStartCorrect, true, `${id}未完成LKJ开车对标`);
  assert(sim.state.distance >= ROUTE_CONTEXT.trainingEndDistance);
  const procedure = procedureState(sim.state);
  const result = scoreRun(sim.state);
  assert.equal(procedure.done, true, `${id}仍有未完成评分项`);
  assert.deepEqual(procedure.complete, Array(PROCEDURE.length).fill(true), `${id}评分项完成状态异常`);
  assert.equal(result.completed, PROCEDURE.length, `${id}完成项数量异常`);
  assert.equal(result.deductions, 0, `${id}规范流程不应产生操作扣分`);
  assert.equal(result.score, 100, `${id}规范流程未获得100分`);
  assert.equal(result.itemScores.reduce((sum, item) => sum + item.earned, 0), 100, `${id}逐项得分合计异常`);
  return sim;
}

for (const id of ['normal', 'weather', 'greenPermit', 'routeTicket']) runScenario(id);

for (const id of ['greenPermit', 'routeTicket']) {
  const blocked = prepare(id);
  if (id === 'greenPermit') assert.equal(blocked.command('station-contact'), true);
  else assert.equal(blocked.command('order-sign'), true);
  assert.equal(blocked.command('credential-open'), true);
  assert.equal(blocked.command('credential-submit', true), true);
  assert.equal(blocked.command('departure-notice'), false, `${id}未解锁时错误放行`);
  assert.equal(blocked.state.departureNoticeReceived, false, `${id}未解锁时错误记录发车通知`);
  assert.equal(blocked.state.authority, false, `${id}未解锁时错误取得行车授权`);
}

const assessedWrong = prepare('greenPermit', 'assessment');
assert.equal(assessedWrong.command('station-contact'), true);
assert.equal(assessedWrong.command('credential-open'), true);
assert.equal(assessedWrong.command('credential-submit', false), true);
assert.equal(assessedWrong.command('lkj-special-unlock', '000000'), true);
assert.equal(assessedWrong.command('departure-notice'), true);
assert.equal(assessedWrong.command('hand-signal-confirm'), true);
assert.equal(procedureState(assessedWrong.state).complete[7], true, '考评模式错误操作应记录后继续流程');
assert.equal(scoreRun(assessedWrong.state).itemScores[7].earned, 0, '错误凭证或错误解锁不应获得第8项分数');

const mismatch = prepare('weather');
mismatch.command('order-sign');
mismatch.command('locomotive-signal-answer', 'green');
mismatch.command('weather-report');
mismatch.command('hand-signal-confirm');
mismatch.command('headlight');
mismatch.command('horn');
mismatch.command('direction', 'F');
mismatch.command('traction', 1);
for (let index = 0; index < 12000 && mismatch.state.credentialStage !== 'confirm-ground-signal'; index += 1) mismatch.tick(0.05);
assert.equal(mismatch.command('signal-answer', 'red'), false);
assert.equal(mismatch.state.signalMismatch, true);
assert.equal(mismatch.state.authority, false);
assert.equal(mismatch.state.traction, 0);
assert.equal(mismatch.state.autoBrake, 5);

assert.equal(PROCEDURE.reduce((sum, [, , weight]) => sum + weight, 0), 100);
console.log('Training scenarios valid: normal, weather, greenPermit, routeTicket; mismatch stop and LKJ unlock checks passed.');
