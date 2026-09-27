export const PROCEDURE = [
  ['选择确认行车凭证场景', s => s.scenarioSelected, 5],
  ['确认设备初始位置', s => s.initialConfirmed || (s.trainingMode === 'assessment' && s.initialAttempted), 10, s => s.initialConfirmed],
  ['输入并核对 LKJ 参数和运行揭示', s => s.lkjConfirmed || (s.trainingMode === 'assessment' && s.lkjAttempted), 20, s => s.lkjConfirmed],
  ['升受电弓、闭合主断并建立总风', s => s.panto && s.netVoltage >= 22.5 && s.mainBreaker && s.compressor && s.mainRes >= 750, 15],
  ['简略制动机试验：减压并确认制动', s => s.brakeTested, 8],
  ['大闸回运转位并确认缓解', s => s.releaseObserved, 7],
  ['缓解停放制动', s => !s.parkingBrake, 5],
  ['确认本场景行车凭证及开车通知', s => s.credentialConfirmed, 20, s => s.credentialCorrect],
  ['开启前照灯并鸣笛', s => s.headlight && s.horn, 5],
  ['方向手柄置前进', s => s.direction === 'F', 3],
  ['低级位平稳起动', s => s.speed >= 5 && s.traction > 0, 4],
  ['LKJ 开车对标', s => s.lkjStartCorrect || (s.trainingMode === 'assessment' && s.lkjStartAttempted), 5, s => s.lkjStartCorrect],
  ['越过出站信号机后稳定运行 300 m', s => s.completed, 3],
];

export function procedureState(state) {
  const complete = PROCEDURE.map(([, test]) => test(state));
  const current = complete.findIndex((done) => !done);
  return { complete, current: current < 0 ? PROCEDURE.length - 1 : current, done: complete.every(Boolean) };
}

export function scoreRun(state) {
  const p = procedureState(state);
  const itemScores = PROCEDURE.map(([label, workflowTest, weight, scoreTest = workflowTest]) => ({
    label, weight, complete: workflowTest(state), correct: scoreTest(state), earned: scoreTest(state) ? weight : 0,
  }));
  const base = itemScores.reduce((sum, item) => sum + item.earned, 0);
  const deductions = Math.min(20, state.rejected * 2 + state.abrupt * 2 + (state.maxAcceleration > .55 ? 4 : 0));
  return { score: Math.max(0, Math.min(100, base - deductions)), completed: p.complete.filter(Boolean).length, deductions, itemScores };
}
