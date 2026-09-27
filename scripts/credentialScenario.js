export const SCENARIOS = {
  normal: {
    id: 'normal',
    label: '正常发车',
    shortLabel: '正常',
    credential: '出站信号',
    signalAspect: 'green',
    description: '凭地面出站信号和七斗冲方向进路确认发车。',
    audio: 'station-normal-signal-ready.mp3',
    documentTitle: '',
    documentFields: [],
  },
  weather: {
    id: 'weather',
    label: '天气恶劣',
    shortLabel: '天气',
    credential: '机车信号＋开车通知',
    signalAspect: 'green',
    description: '地面出站信号无法辨认，先按机车信号和开车通知起动，再确认地面信号。',
    audio: 'station-departure-notice.mp3',
    documentTitle: '调度命令（教学情境）',
    documentText: '自接令时起，株洲站至七斗冲站间改按天气恶劣难以辨认信号办法行车。列车按机车信号显示运行；接近地面信号机时须确认地面信号。',
    documentFields: [],
  },
  greenPermit: {
    id: 'greenPermit',
    label: '绿色许可证',
    shortLabel: '绿证',
    credential: '绿色许可证',
    signalAspect: 'red',
    description: '出站信号机故障，核对绿色许可证后凭证发车。',
    audio: 'station-green-permit.mp3',
    finalAudio: 'station-departure-notice.mp3',
    documentTitle: '绿色许可证',
    documentText: '在出站信号机故障的情况下，准许两洞两六次列车由株洲站一道发车。',
    documentFields: [
      ['train', '车次', '2026次'],
      ['track', '发车线路', '株洲站1道'],
      ['reason', '适用原因', '出站信号机故障'],
      ['number', '许可证编号', '绿证Z-2026-01'],
      ['date', '填发日期', '课堂训练当日'],
    ],
  },
  routeTicket: {
    id: 'routeTicket',
    label: '电话闭塞路票',
    shortLabel: '路票',
    credential: '路票',
    signalAspect: 'red',
    description: '停止基本闭塞法，改按电话闭塞法行车，核对路票后发车。',
    audio: 'station-departure-notice.mp3',
    documentTitle: '路票',
    orderTitle: '调度命令（教学情境）',
    orderText: '株洲站至七斗冲站间停止基本闭塞法，改按电话闭塞法行车。两洞两六次列车凭路票进入区间。',
    documentText: '电话闭塞行车凭证：路票。请逐项核对后确认。',
    documentFields: [
      ['train', '车次', '2026次'],
      ['section', '区间', '株洲站至七斗冲站'],
      ['record', '电话记录号码', 'ZQ-2026-018'],
      ['line', '线别/方向', '京广下行线，七斗冲方向'],
      ['date', '填发日期', '课堂训练当日'],
    ],
  },
};

export const ROUTE_CONTEXT = {
  station: '株洲站',
  track: '1道',
  direction: '七斗冲方向',
  trainNo: '2026次',
  locomotive: 'HXD1C',
  // 以驾驶台视点所在的实际控制路径投影为准，避免判定位置早于三维实体。
  departureSignalDistance: 571.53,
  departureSignalSourceUid: 172,
  // 与本线出站信号机并列的邻线信号机，仅作“不得越过”的红灯教学参照。
  neighborSignalSourceUid: 173,
  trainingEndDistance: 871.53,
  // 以下为课堂网页的可操作容差，并非现场规章规定的距离。
  weatherSignalClearDistance: 50,
  weatherSignalApproachDistance: 150,
  lkjStartTolerance: 10,
};

export function getScenario(id) {
  return SCENARIOS[id] || SCENARIOS.normal;
}

export function scenarioAudioPath(id, phase = 'primary') {
  const scenario = getScenario(id);
  const file = phase === 'final' ? (scenario.finalAudio || scenario.audio) : scenario.audio;
  return `./assets/audio/radio/${file}`;
}
