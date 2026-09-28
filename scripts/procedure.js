export const PROCEDURE = [
  ['选择确认行车凭证场景', s => s.scenarioSelected, 5],
  ['确认设备初始位置', s => s.initialConfirmed || (s.trainingMode === 'assessment' && s.initialAttempted), 8, s => s.initialConfirmed],
  ['输入并核对 LKJ 参数和运行揭示', s => s.lkjConfirmed || (s.trainingMode === 'assessment' && s.lkjAttempted), 15, s => s.lkjConfirmed],
  ['升受电弓、闭合主断并建立总风', s => s.panto && s.netVoltage >= 22.5 && s.mainBreaker && s.compressor && s.mainRes >= 750, 10],
  ['简略制动机试验：减压并确认制动', s => s.brakeTested, 7],
  ['大闸回运转位并确认缓解', s => s.releaseObserved, 5],
  ['缓解停放制动', s => !s.parkingBrake, 5],
  ['通过CIR查询列尾风压，确认行车凭证、开车通知及发车手信号', s => (s.tailPressureQueried || s.trainingMode === 'assessment') && s.credentialConfirmed && (!s.lkjUnlockRequired || s.lkjUnlockCorrect || (s.trainingMode === 'assessment' && s.lkjUnlockAttempted)) && (!s.handSignalRequired || s.handSignalConfirmed) && (s.credentialCorrect || s.trainingMode === 'assessment'), 20, s => s.tailPressureQueried && s.credentialCorrect && (!s.lkjUnlockRequired || s.lkjUnlockCorrect) && (!s.handSignalRequired || s.handSignalConfirmed)],
  ['开启前照灯并鸣笛', s => s.headlight && s.horn, 5],
  ['方向手柄置前进', s => s.direction === 'F', 3],
  // 低级位平稳起动的完成标志是列车已经平稳滚动，不能错误地要求低级位一直维持到 5 km/h。
  ['低级位平稳起动', s => s.lowNotchStartConfirmed, 5],
  ['LKJ 开车对标', s => s.lkjStartCorrect || (s.trainingMode === 'assessment' && s.lkjStartAttempted), 7, s => s.lkjStartCorrect],
  ['越过出站信号机后稳定运行 300 m', s => s.completed, 5],
];

export function procedureState(state) {
  const complete = PROCEDURE.map(([, test]) => test(state));
  const current = complete.findIndex((done) => !done);
  return { complete, current: current < 0 ? PROCEDURE.length - 1 : current, done: complete.every(Boolean) };
}

function credentialStepEarned(state) {
  const locked = new Set(state.assessmentCredentialLocks || []);
  if (!state.lkjUnlockRequired) {
    return (state.credentialCorrect && !locked.has('credential') ? 12 : 0)
      + (state.tailPressureQueried && !locked.has('tail') ? 3 : 0)
      + ((!state.handSignalRequired || state.handSignalConfirmed) && !locked.has('handSignal') ? 5 : 0);
  }
  let earned = 0;
  if (state.credentialCorrect && !locked.has('credential')) earned += 5;
  if (state.departureNoticeReceived && !locked.has('notice')) earned += 2;
  if ((!state.handSignalRequired || state.handSignalConfirmed) && !locked.has('handSignal')) earned += 3;
  if (state.tailPressureQueried && !locked.has('tail')) earned += 2;
  if (state.lkjUnlockMethodCorrect && !state.lkjUnlockMethodErrorRecorded && !locked.has('method')) earned += 2;
  if (state.lkjUnlockFieldsCorrect && !state.lkjUnlockFieldsErrorRecorded && !locked.has('fields')) earned += 3;
  if (state.lkjUnlockCombinationCorrect && !state.lkjUnlockCombinationErrorRecorded && !locked.has('combination')) earned += 3;
  return earned;
}

export function scoreRun(state) {
  const p = procedureState(state);
  const scoreLocks = new Set(state.assessmentScoreLocks || []);
  const itemScores = PROCEDURE.map(([label, workflowTest, weight, scoreTest = workflowTest], index) => {
    const rawEarned = index === 7 ? credentialStepEarned(state) : scoreTest(state) ? weight : 0;
    const earned = scoreLocks.has(index) ? 0 : rawEarned;
    return {
      label, weight, complete: workflowTest(state), correct: earned === weight, earned,
      locked: scoreLocks.has(index),
    };
  });
  const base = itemScores.reduce((sum, item) => sum + item.earned, 0);
  const deductions = Math.min(20, state.rejected * 2 + state.abrupt * 2 + (state.maxAcceleration > .55 ? 4 : 0));
  return { score: Math.max(0, Math.min(100, base - deductions)), completed: p.complete.filter(Boolean).length, deductions, itemScores };
}
