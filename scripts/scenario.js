export const SIGNAL_ASPECTS = {
  green: {
    label: '绿灯', frame: 7,
    meaning: '准许列车按规定速度运行，表示运行前方至少有三个闭塞分区空闲。',
  },
  greenYellow: {
    label: '绿黄色灯', frame: 6,
    meaning: '准许列车按规定速度注意运行，表示运行前方至少有两个闭塞分区空闲。',
  },
  yellow: {
    label: '黄灯', frame: 5,
    meaning: '准许列车按规定速度注意运行，表示运行前方有一个闭塞分区空闲。',
  },
  red: {
    label: '红灯', frame: 0,
    meaning: '禁止越过该信号机。',
  },
};

export const ASSESSMENT_ASPECTS = ['green', 'greenYellow', 'yellow'];

// 课堂训练固定数据：仅用于本网页的操作核对，不作为实际行车参数或运行揭示。
export const LKJ_TRAINING_PARAMETERS = {
  driverId: '0001',
  assistantId: '0002',
  section: '101',
  station: '203',
  trainNo: '2026',
  trainType: '2',
  weight: '2800',
  cars: '50',
  length: '690',
};

export const LKJ_FIELD_DEFINITIONS = [
  ['driverId', '司机号', '0001'],
  ['assistantId', '副司机号', '0002'],
  ['section', '区段号', '101'],
  ['station', '车站号', '203（株洲）'],
  ['trainNo', '车次', '2026'],
  ['trainType', '列车种类代码', '2＝货物列车'],
  ['weight', '总重（t）', '2800'],
  ['cars', '辆数', '50'],
  ['length', '列车长度（m）', '690'],
];

export const RUNNING_NOTICES = [
  '株洲站 1 道出发，运行方向：七斗冲方向。',
  '本次为 2026 次货物列车，机车型号 HXD1C。',
  '行车凭证按当前教学场景确认；揭示仅供课堂训练使用。',
];

export function isLkjParameterMatch(input = {}) {
  return getLkjMismatchFields(input).length === 0;
}

// 评分和流程推进必须使用同一组训练参数。返回字段名而不是只返回 true/false，
// 这样考评模式可以记录错误、扣分并继续，而不会因为一次错误输入把整个流程锁死。
export function getLkjMismatchFields(input = {}) {
  return Object.entries(LKJ_TRAINING_PARAMETERS)
    .filter(([key, value]) => String(input[key] ?? '').trim() !== value)
    .map(([key]) => key);
}
