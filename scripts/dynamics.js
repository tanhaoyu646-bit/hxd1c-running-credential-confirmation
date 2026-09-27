import { SIGNAL_ASPECTS, getLkjMismatchFields } from './scenario.js?rev=assessment-softflow-v1-20260925';
import { getScenario, ROUTE_CONTEXT } from './credentialScenario.js?rev=workflow-signal-lkj-v2-20260927';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const TRACTION_BRAKE_CYL_MAX = 15;

const INITIAL_CHECK_LABELS = {
  traction: '牵引手柄零位',
  direction: '换向手柄中立位',
  autoBrake: '自动制动阀运转位',
  independentBrake: '单独制动阀缓解位',
  parkingBrake: '停放制动施加',
  panto: '受电弓降位',
  mainBreaker: '主断路器分位',
  compressor: '空压机停止位',
};

export class TrainSimulation {
  constructor() {
    this.listeners = new Set();
    this.reset();
  }
  reset() {
    this.state = {
      controlPowerOutput: true, parkingPower: true, output24V: true, powerOn: true,
      initialConfirmed: false, initialAttempted: false,
      lkjConfirmed: false, lkjAttempted: false, lkjCorrect: false, lkjErrors: [], lkjData: null,
      lkjStartAttempted: false, lkjStartCorrect: false, lkjStartError: '', lkjStartDistance: null,
      panto: false, mainBreaker: false, compressor: false,
      parkingBrake: true, authority: false, trainingMode: 'teaching', signalAspect: 'green', signalObserved: false, signalAnswer: null,
      signalMeaningCorrect: false, handSignalRequired: true, handSignalConfirmed: false,
      scenarioId: 'normal', scenarioSelected: false, credentialStage: 'select',
      radioContacted: false, orderSigned: false, credentialPresented: false,
      credentialAttempted: false, credentialCorrect: false, credentialConfirmed: false,
      directionObserved: false, directionCorrect: false, locomotiveSignalObserved: false,
      weatherReportSent: false, departureNoticeReceived: false, limitedStart: false,
      signalMismatch: false, signalPassed: false, completed: false,
      headlight: false, horn: false, hornActive: false, vigilanceAcknowledged: false, direction: 'N',
      auxiliaryLight: false, markerFront: '0', markerRear: '0', cabLight: false,
      // 初始为大闸运转位、小闸缓解位，车辆由停放制动保持；这样才符合后续“减压试验—回运转位”的教学流程。
      autoBrake: 0, independentBrake: 0, traction: 0,
      // HXD1C 原游戏 .eng：总风 108.78～130.53 psi（约 750～900 kPa），
      // 列车管/均衡风缸运转压力 87.02 psi（约 600 kPa）。
      mainRes: 750, equalizingRes: 600, trainPipe: 600, brakeCyl: 0,
      initialChecks: Object.fromEntries(Object.keys(INITIAL_CHECK_LABELS).map((key) => [key, false])),
      netVoltage: 0, speed: 0, distance: 0, tractionForce: 0, brakeForce: 0,
      brakeTested: false, releaseObserved: false, elapsed: 0,
      rejected: 0, abrupt: 0, maxAcceleration: 0, maxJerk: 0, lastAcceleration: 0,
    };
    this.emit();
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(message = '') { for (const fn of this.listeners) fn(this.state, message); }
  reject(message) { this.state.rejected += 1; this.emit(message); return false; }
  initialCheckIsCorrect(key) {
    const s = this.state;
    return ({
      traction: s.traction === 0,
      direction: s.direction === 'N',
      autoBrake: s.autoBrake === 0,
      independentBrake: s.independentBrake === 0,
      parkingBrake: s.parkingBrake === true,
      panto: s.panto === false,
      mainBreaker: s.mainBreaker === false,
      compressor: s.compressor === false,
    })[key] === true;
  }
  invalidateInitialCheck(key) {
    const s = this.state;
    if (s.lkjConfirmed || !Object.prototype.hasOwnProperty.call(INITIAL_CHECK_LABELS, key)) return;
    s.initialChecks[key] = false;
    s.initialConfirmed = false;
  }
  initialChecksComplete() {
    return Object.keys(INITIAL_CHECK_LABELS).every((key) => this.state.initialChecks[key] && this.initialCheckIsCorrect(key));
  }
  isAssessment() { return this.state.trainingMode === 'assessment'; }
  initialWorkflowReady() { return this.state.initialConfirmed || (this.isAssessment() && this.state.initialAttempted); }
  lkjWorkflowReady() { return this.state.lkjConfirmed || (this.isAssessment() && this.state.lkjAttempted); }
  tractionInterlockReasons() {
    const s = this.state;
    const reasons = [];
    if (!s.authority) reasons.push('行车凭证、开车通知或发车手信号尚未正确确认');
    if (!s.mainBreaker) reasons.push('主断路器未闭合');
    if (!s.headlight) reasons.push('前照灯未开启');
    if (!s.horn) reasons.push('尚未鸣笛');
    if (s.direction !== 'F') reasons.push('换向手柄未在前进位');
    if (s.parkingBrake) reasons.push('停放制动未缓解');
    if (s.autoBrake > 0) reasons.push('自动制动阀未在运转位');
    if (s.independentBrake > 0) reasons.push('单独制动阀未在缓解位');
    if (s.brakeCyl >= TRACTION_BRAKE_CYL_MAX) reasons.push(`制动缸压力仍为 ${Math.ceil(s.brakeCyl)} kPa`);
    return reasons;
  }
  syncAuthority() {
    const s = this.state;
    const scenario = getScenario(s.scenarioId);
    const lkjReady = this.lkjWorkflowReady();
    if (scenario.id === 'normal') {
      s.credentialConfirmed = Boolean(s.radioContacted && s.signalObserved && s.directionObserved);
      s.credentialCorrect = Boolean(s.radioContacted && s.signalMeaningCorrect && s.directionCorrect);
      s.authority = Boolean(lkjReady && s.credentialConfirmed && (s.credentialCorrect || this.isAssessment()) && (!s.handSignalRequired || s.handSignalConfirmed));
    } else if (scenario.id === 'weather') {
      s.credentialConfirmed = Boolean(s.orderSigned && s.locomotiveSignalObserved && s.weatherReportSent && s.departureNoticeReceived);
      s.credentialCorrect = Boolean(s.credentialConfirmed && !s.signalMismatch);
      s.authority = Boolean(lkjReady && s.credentialConfirmed && !s.signalMismatch && (!s.handSignalRequired || s.handSignalConfirmed));
    } else {
      s.credentialConfirmed = Boolean(s.credentialAttempted && s.departureNoticeReceived);
      s.authority = Boolean(lkjReady && s.credentialConfirmed && (s.credentialCorrect || this.isAssessment()) && (!s.handSignalRequired || s.handSignalConfirmed));
    }
  }
  command(id, value) {
    const s = this.state;
    if (id === 'initial-inspect') {
      const key = String(value || '');
      if (!Object.prototype.hasOwnProperty.call(INITIAL_CHECK_LABELS, key)) return this.reject('未识别的初始位置核对项目。');
      if (!this.initialCheckIsCorrect(key)) return this.reject(`${INITIAL_CHECK_LABELS[key]}不正确，请先调整到规定位置。`);
      s.initialChecks[key] = true;
      this.emit(`已核对：${INITIAL_CHECK_LABELS[key]}。`);
      return true;
    }
    if (id === 'initial-confirm') {
      s.initialAttempted = true;
      if (!this.initialChecksComplete()) {
        const missing = Object.keys(INITIAL_CHECK_LABELS).filter((key) => !s.initialChecks[key] || !this.initialCheckIsCorrect(key));
        if (this.isAssessment()) {
          this.emit(`初始位置核对不完整，已记录 ${missing.length} 项错误；考评流程继续，成绩按实际核对结果计分。`);
          return true;
        }
        return this.reject(`请逐项核对设备初始位置：${missing.map((key) => INITIAL_CHECK_LABELS[key]).join('、')}。`);
      }
      s.initialConfirmed = true; this.emit('设备初始位置已核对。'); return true;
    }
    if (id === 'scenario-select') {
      const scenario = getScenario(value);
      s.scenarioId = scenario.id;
      s.scenarioSelected = true;
      s.signalAspect = scenario.signalAspect;
      s.signalObserved = false; s.signalAnswer = null; s.signalMeaningCorrect = false;
      s.credentialStage = 'prepare'; s.radioContacted = false; s.orderSigned = false;
      s.credentialPresented = false; s.credentialAttempted = false; s.credentialCorrect = false;
      s.directionObserved = false; s.directionCorrect = false; s.locomotiveSignalObserved = false;
      s.weatherReportSent = false; s.departureNoticeReceived = false; s.limitedStart = false;
      s.handSignalRequired = true; s.handSignalConfirmed = false;
      s.signalMismatch = false; s.signalPassed = false; s.completed = false;
      this.syncAuthority();
      this.emit(`已选择“${scenario.label}”场景：${scenario.description}`);
      return true;
    }
    if (id === 'station-contact') {
      if (!s.scenarioSelected) return this.reject('请先选择训练场景。');
      const scenario = getScenario(s.scenarioId);
      if (scenario.id === 'weather' || scenario.id === 'routeTicket') return this.reject('本场景应先确认调度命令。');
      s.radioContacted = true;
      s.credentialStage = scenario.id === 'normal' ? 'observe-signal' : 'check-credential';
      this.emit('车站联控录音已播放；联控应答完成。请继续按当前场景确认。');
      return true;
    }
    if (id === 'order-sign') {
      const scenario = getScenario(s.scenarioId);
      if (!['weather', 'routeTicket'].includes(scenario.id)) return this.reject('当前场景无需签收调度命令。');
      s.orderSigned = true;
      s.credentialStage = scenario.id === 'weather' ? 'confirm-loco-signal' : 'check-credential';
      this.emit('调度命令已签收并确认。');
      return true;
    }
    if (id === 'locomotive-signal-answer') {
      if (s.scenarioId !== 'weather' || !s.orderSigned) return this.reject('请先签收天气恶劣行车调度命令。');
      s.locomotiveSignalObserved = value === 'green';
      if (!s.locomotiveSignalObserved) return this.reject('本教学情境中机车信号为绿灯，请重新确认。');
      s.credentialStage = 'report-ground-unavailable';
      this.emit('已确认机车信号绿灯。请报告地面出站信号无法辨认。');
      return true;
    }
    if (id === 'weather-report') {
      if (s.scenarioId !== 'weather' || !s.locomotiveSignalObserved) return this.reject('请先确认机车信号。');
      s.weatherReportSent = true; s.departureNoticeReceived = true; s.limitedStart = true; s.credentialStage = 'limited-start';
      this.syncAuthority(); this.emit('已报告地面出站信号无法辨认；已收到发车通知，按机车信号低速起动。');
      return true;
    }
    if (id === 'credential-open') {
      const scenario = getScenario(s.scenarioId);
      if (!s.scenarioSelected) return this.reject('请先选择训练场景。');
      if (scenario.id === 'greenPermit' && !s.radioContacted) return this.reject('请先完成车站关于绿色许可证的联控。');
      if (scenario.id === 'routeTicket' && !s.orderSigned) return this.reject('请先签收停止基本闭塞法的调度命令。');
      s.credentialPresented = true; this.emit(`${scenario.documentTitle}已显示，请逐项核对。`); return true;
    }
    if (id === 'credential-submit') {
      const scenario = getScenario(s.scenarioId);
      if (!['greenPermit', 'routeTicket'].includes(scenario.id) || !s.credentialPresented) return this.reject('当前尚未显示需核对的行车凭证。');
      const correct = Boolean(value);
      if (!correct && !this.isAssessment()) {
        s.credentialAttempted = false; s.credentialCorrect = false; this.syncAuthority();
        return this.reject('凭证核对不正确，请重新逐项核对。');
      }
      s.credentialAttempted = true; s.credentialCorrect = correct;
      s.credentialStage = 'await-departure-notice';
      this.emit(s.credentialCorrect ? '行车凭证已核对。请接收发车通知。' : '凭证核对错误已记录；考评流程继续。');
      return true;
    }
    if (id === 'departure-notice') {
      const scenario = getScenario(s.scenarioId);
      if (!['greenPermit', 'routeTicket'].includes(scenario.id) || !s.credentialAttempted) return this.reject('请先完成行车凭证核对。');
      s.departureNoticeReceived = true; s.credentialStage = 'ready-depart'; this.syncAuthority();
      this.emit('已收到发车通知；联控应答完成，具备发车条件。'); return true;
    }
    if (id === 'direction-answer') {
      if (s.scenarioId !== 'normal' || !s.radioContacted || !s.signalMeaningCorrect) return this.reject('请先完成车站联控和出站信号确认。');
      const correct = value === 'qidouchong';
      if (!correct && !this.isAssessment()) {
        s.directionObserved = false; s.directionCorrect = false; this.syncAuthority();
        return this.reject('运行方向不正确，请根据联控内容重新确认。');
      }
      s.directionObserved = true; s.directionCorrect = correct; this.syncAuthority();
      this.emit(s.directionCorrect ? '已确认七斗冲方向，具备发车条件。' : '方向确认错误已记录；考评流程继续。'); return true;
    }
    if (id === 'training-mode') {
      if (!['teaching', 'assessment'].includes(value)) return this.reject('未识别的训练模式。');
      s.trainingMode = value;
      this.emit(value === 'teaching' ? '已进入教学模式。' : '已进入考评模式：错误将记录在本次成绩中。'); return true;
    }
    if (id === 'signal-aspect') {
      if (s.trainingMode !== 'teaching') return this.reject('考评模式不允许手动改变信号。');
      if (!SIGNAL_ASPECTS[value]) return this.reject('未识别的信号显示。');
      s.signalAspect = value; s.signalObserved = false; s.signalAnswer = null; s.signalMeaningCorrect = false; this.syncAuthority();
      this.emit(`教学信号已设置为${SIGNAL_ASPECTS[value].label}。`); return true;
    }
    if (id === 'hand-signal-required') {
      s.handSignalRequired = Boolean(value); s.handSignalConfirmed = false; this.syncAuthority();
      this.emit(s.handSignalRequired ? '本场景要求确认发车手信号。' : '本场景不要求发车手信号。'); return true;
    }
    if (id === 'signal-answer') {
      if (!this.lkjWorkflowReady() && !this.isAssessment()) return this.reject('请先完成 LKJ 参数与运行揭示核对。');
      const scenario = getScenario(s.scenarioId);
      if (!s.scenarioSelected) return this.reject('请先选择训练场景。');
      if (scenario.id === 'normal' && !s.radioContacted) return this.reject('请先接收车站关于出站信号和方向的联控。');
      if (scenario.id === 'weather' && s.credentialStage !== 'confirm-ground-signal') return this.reject('天气恶劣场景应在接近出站信号机时再确认地面信号。');
      s.signalObserved = true;
      s.signalAnswer = value;
      s.signalMeaningCorrect = value === s.signalAspect;
      if (scenario.id === 'weather') {
        if (!s.signalMeaningCorrect) {
          s.signalMismatch = true; s.authority = false; s.traction = 0; s.autoBrake = 5;
          this.emit('地面信号与机车信号不一致：已实施立即停车。');
          return false;
        }
        s.limitedStart = false; s.credentialStage = 'continue-after-ground-signal'; this.syncAuthority();
        this.emit('地面信号与机车信号一致，可继续运行。'); return true;
      }
      this.syncAuthority();
      if (!s.signalMeaningCorrect) {
        if (this.isAssessment()) {
          this.emit(`信号确认错误已记录：所选${SIGNAL_ASPECTS[value]?.label || '未知显示'}，实际为${SIGNAL_ASPECTS[s.signalAspect].label}；考评流程继续。`);
          return true;
        }
        return this.reject('信号显示或含义确认不正确，请重新观察出站信号机。');
      }
      if (s.signalAspect === 'red') return this.emit('已正确确认红灯：不得凭地面信号越过，请继续按本场景确认行车凭证。'), true;
      this.emit(`已正确确认${SIGNAL_ASPECTS[s.signalAspect].label}。请继续确认运行方向。`); return true;
    }
    if (id === 'hand-signal-confirm') {
      if (!s.credentialConfirmed) return this.reject('请先完成本场景行车凭证和开车通知确认。');
      if (!s.credentialCorrect && !this.isAssessment()) return this.reject('行车凭证或运行方向核对不正确，不能确认发车手信号。');
      s.handSignalConfirmed = true; this.syncAuthority(); this.emit('发车手信号已确认，具备发车条件。'); return true;
    }
    if (id === 'power-cabinet-switch') {
      const allowed = ['controlPowerOutput', 'parkingPower', 'output24V'];
      const key = value?.key;
      if (!allowed.includes(key)) return this.reject('未识别的控制电源柜开关。');
      const enabled = Boolean(value?.enabled);
      if (enabled && !s.powerOn && (s.traction !== 0 || s.direction !== 'N' || !s.parkingBrake)) return this.reject('初始位置不正确：确认牵引零位、方向中立并施加停放制动。');
      s[key] = enabled;
      const wasPowered = s.powerOn;
      s.powerOn = s.controlPowerOutput && s.parkingPower && s.output24V;
      if (s.powerOn) s.initialConfirmed = false;
      if (!s.powerOn) {
        s.mainBreaker = false;
        s.compressor = false;
        if (wasPowered) { s.lkjConfirmed = false; s.lkjData = null; }
      }
      const names = { controlPowerOutput: '控制电源输出', parkingPower: '停放制动电源', output24V: '24V 输出' };
      this.emit(s.powerOn ? '三项电源均已接通，司机室控制电源建立。' : `${names[key]}已${enabled ? '接通' : '断开'}；须完成三项操作才能建立控制电源。`);
      return true;
    }
    if (id === 'control-power') {
      if (!s.powerOn && (s.traction !== 0 || s.direction !== 'N' || !s.parkingBrake)) return this.reject('初始位置不正确：确认牵引零位、方向中立并施加停放制动。');
      const next = !s.powerOn;
      s.controlPowerOutput = next; s.parkingPower = next; s.output24V = next; s.powerOn = next;
      if (next) s.initialConfirmed = false;
      else { s.mainBreaker = false; s.compressor = false; s.lkjConfirmed = false; s.lkjData = null; }
      this.emit(next ? '调试快捷操作：三项控制电源已接通。' : '调试快捷操作：三项控制电源已断开。'); return true;
    }
    if (id === 'lkj-confirm') {
      const required = ['driverId', 'assistantId', 'section', 'station', 'trainNo', 'trainType', 'weight', 'cars', 'length'];
      const missing = !value ? required : required.filter((key) => String(value[key] ?? '').trim() === '');
      const incorrect = missing.length ? required : getLkjMismatchFields(value);
      if (!this.initialWorkflowReady() && !this.isAssessment()) return this.reject('请先确认设备初始位置。');
      s.lkjAttempted = true;
      s.lkjData = { ...(value || {}) };
      s.lkjErrors = incorrect;
      s.lkjCorrect = incorrect.length === 0;
      s.lkjConfirmed = s.lkjCorrect;
      s.lkjStartAttempted = false; s.lkjStartCorrect = false; s.lkjStartError = ''; s.lkjStartDistance = null;
      this.syncAuthority();
      if (!s.lkjCorrect) {
        if (this.isAssessment()) {
          this.emit(`LKJ 参数错误已记录（${incorrect.length} 项）；考评流程继续，本项按实际正确性计分。`);
          return true;
        }
        return this.reject(missing.length ? 'LKJ 参数不完整，不能确认。' : 'LKJ 参数与本次课堂训练任务不一致，请复核后重新输入。');
      }
      this.emit('LKJ 参数已输入，运行揭示已查询确认；列车起动后须在开车对标点按压【开车／7】键。'); return true;
    }
    if (id === 'lkj-start') {
      if (!s.lkjConfirmed) return this.reject('请先完成 LKJ 参数和运行揭示核对。');
      s.lkjStartAttempted = true;
      s.lkjStartDistance = s.distance;
      const delta = s.distance - ROUTE_CONTEXT.departureSignalDistance;
      if (s.speed < 1) {
        s.lkjStartError = 'stationary';
        return this.reject('列车尚未起动；应在起动后到达开车对标点时按压【开车／7】键。');
      }
      if (Math.abs(delta) > ROUTE_CONTEXT.lkjStartTolerance) {
        s.lkjStartError = delta < 0 ? 'early' : 'late';
        return this.reject(delta < 0
          ? `尚未到达 LKJ 开车对标点（距规定点 ${Math.ceil(Math.abs(delta))} m）。`
          : `已越过 LKJ 开车对标点 ${Math.ceil(delta)} m，本次对标错误已记录。`);
      }
      s.lkjStartCorrect = true;
      s.lkjStartError = '';
      this.emit('LKJ 开车对标完成，装置已进入正常监控状态。');
      return true;
    }
    if (id === 'lkj') { s.lkjData = { debug: true }; s.lkjAttempted = true; s.lkjCorrect = true; s.lkjConfirmed = true; s.lkjStartAttempted = false; s.lkjStartCorrect = false; this.syncAuthority(); this.emit('调试快捷操作：LKJ 已确认。'); return true; }
    if (id === 'panto') { const next=value===undefined?!s.panto:Boolean(value); if (next && !this.lkjWorkflowReady()) return this.reject('请先完成 LKJ 参数输入与运行揭示核对。'); this.invalidateInitialCheck('panto'); s.panto = next; if (!s.panto) s.mainBreaker = false; this.emit(s.panto ? '受电弓已升起，正在建立网压。' : '受电弓已降下。'); return true; }
    if (id === 'main-breaker') { const next=value===undefined?!s.mainBreaker:Boolean(value); if (next && (!s.panto || s.netVoltage < 19)) return this.reject('网压未建立，禁止闭合主断路器。'); this.invalidateInitialCheck('mainBreaker'); s.mainBreaker = next; this.emit(s.mainBreaker ? '主断路器已闭合。' : '主断路器已断开。'); return true; }
    if (id === 'compressor') { const next=value===undefined?!s.compressor:Boolean(value); if (next && !s.mainBreaker) return this.reject('主断路器未闭合，空压机不能投入。'); this.invalidateInitialCheck('compressor'); s.compressor = next; this.emit(s.compressor ? '空气压缩机已投入。' : '空气压缩机已停止。'); return true; }
    if (id === 'parking-apply') { this.invalidateInitialCheck('parkingBrake'); s.parkingBrake = true; this.emit('停放制动已施加。'); return true; }
    if (id === 'parking-release') { if (s.mainRes < 600) return this.reject('总风压力低于 600 kPa，不能缓解停放制动。'); this.invalidateInitialCheck('parkingBrake'); s.parkingBrake = false; this.emit('停放制动已缓解。'); return true; }
    if (id === 'parking') { return this.command(s.parkingBrake ? 'parking-release' : 'parking-apply'); }
    if (id === 'authority') { return this.reject('请按当前场景完成行车凭证、联控和发车通知确认。'); }
    if (id === 'headlight') { s.headlight = !s.headlight; this.emit(s.headlight ? '前照灯已开启。' : '前照灯已关闭。'); return true; }
    if (id === 'auxiliary-light') { s.auxiliaryLight = !s.auxiliaryLight; this.emit(s.auxiliaryLight ? '辅照灯已开启。' : '辅照灯已关闭。'); return true; }
    if (id === 'marker-front') { s.markerFront = value || '0'; this.emit(`前标志灯已置于${s.markerFront === 'white' ? '白灯' : s.markerFront === 'red' ? '红灯' : '零位'}。`); return true; }
    if (id === 'marker-rear') { s.markerRear = value || '0'; this.emit(`后标志灯已置于${s.markerRear === 'white' ? '白灯' : s.markerRear === 'red' ? '红灯' : '零位'}。`); return true; }
    if (id === 'cab-light') { s.cabLight = !s.cabLight; this.emit(s.cabLight ? '司机室灯已开启。' : '司机室灯已关闭。'); return true; }
    if (id === 'horn-start') { s.hornActive = true; s.horn = true; this.emit('风笛鸣响。'); return true; }
    if (id === 'horn-stop') { s.hornActive = false; this.emit('风笛停止。'); return true; }
    if (id === 'horn') { s.horn = true; this.emit('调试快捷操作：已执行鸣笛。'); return true; }
    if (id === 'reset') { s.vigilanceAcknowledged = true; this.emit('警惕/复位按钮已按下。'); return true; }
    if (id === 'direction') {
      if (s.traction !== 0) return this.reject('牵引手柄未回零，禁止改变方向。');
      this.invalidateInitialCheck('direction');
      s.direction = value; this.emit(`方向手柄已置于${value === 'F' ? '前进' : value === 'R' ? '后退' : '中立'}位。`); return true;
    }
    if (id === 'auto-brake') {
      const next = clamp(Number(value), 0, 5); if (next < s.autoBrake - 1 || next > s.autoBrake + 2) s.abrupt += 1;
      this.invalidateInitialCheck('autoBrake');
      if (next >= 1 && s.trainPipe > 420) s.brakeTested = true;
      s.autoBrake = next; this.emit(next === 0 ? '自动制动阀已回运转位。' : `自动制动阀置于制动档 ${next}。`); return true;
    }
    if (id === 'independent-brake') { this.invalidateInitialCheck('independentBrake'); s.independentBrake = clamp(Number(value), 0, 5); this.emit('单独制动阀档位已调整。'); return true; }
    if (id === 'traction') {
      // 原 HXD1C Combined_Control：前推为 7 个牵引位，中央为零位，后拉为 8 个电制动位。
      const next = clamp(Number(value), -8, 7);
      if (next - s.traction > 1) s.abrupt += 1;
      this.invalidateInitialCheck('traction');
      const blockers = next > 0 ? this.tractionInterlockReasons() : [];
      if (blockers.length) {
        s.traction = 0;
        s.rejected += 1;
        this.emit(`牵引未投入：${blockers.join('；')}。请确认后重新由零位推至低级位。`);
        return false;
      }
      s.traction = next;
      this.emit(next > 0 ? `牵引手柄置于 ${next} 级。` : next < 0 ? `电制动置于 ${Math.abs(next)} 级。` : '牵引手柄已回零。'); return true;
    }
    return false;
  }
  tick(dt) {
    const s = this.state; s.elapsed += dt;
    const netTarget = s.panto ? 25 : 0; s.netVoltage += (netTarget - s.netVoltage) * Math.min(1, dt * 1.8);
    if (s.compressor && s.mainBreaker) {
      s.mainRes += (900 - s.mainRes) * Math.min(1, dt * .22);
    } else {
      // 停车等待阶段仅模拟微小自然泄漏，不能让总风在几十秒内无故掉到零。
      s.mainRes = Math.max(0, s.mainRes - dt * .35);
    }
    // 原游戏 .eng 的最小减压量为 7.257 psi（约 50 kPa），常用全制动
    // 压力降为 24.65 psi（约 170 kPa）。中间档位用于课堂练习的离散近似，
    // 均衡风缸先变化、列车管滞后跟随。
    const equalizingTargets = [600, 550, 510, 470, 430, 0];
    const equalizingTarget = s.mainRes > 600 ? equalizingTargets[s.autoBrake] : 0;
    const emergencyBrake = s.autoBrake >= 5;
    s.equalizingRes += (equalizingTarget - s.equalizingRes) * Math.min(1, dt * (emergencyBrake ? 5.5 : s.autoBrake > 0 ? 2.4 : .75));
    s.trainPipe += (s.equalizingRes - s.trainPipe) * Math.min(1, dt * (emergencyBrake ? 4.2 : s.autoBrake > 0 ? 1.45 : .48));
    // 停放制动为独立的弹簧储能制动，不应冒充空气制动缸压力；否则大闸缓解试验会永远无法完成。
    const autoCyl = s.mainRes > 600 ? clamp((600 - s.trainPipe) * (350 / 170), 0, 350) : 0; const individualCyl = s.independentBrake * 60;
    const cylTarget = Math.max(autoCyl, individualCyl); s.brakeCyl += (cylTarget - s.brakeCyl) * Math.min(1, dt * 2.3);
    // “制动缓解完成”与牵引联锁使用同一压力阈值，避免流程已变绿但牵引仍被残压阻断。
    if (s.brakeTested && s.autoBrake === 0 && s.trainPipe > 570 && s.brakeCyl < TRACTION_BRAKE_CYL_MAX) s.releaseObserved = true;
    const tractionAllowed = this.tractionInterlockReasons().length === 0;
    s.tractionForce = tractionAllowed && s.traction > 0 ? s.traction * 68000 * Math.max(.34, 1 - s.speed / 125) : 0;
    const electricBrake = s.traction < 0 ? Math.abs(s.traction) * 43000 : 0;
    const parkingBrakeForce = s.parkingBrake ? 450000 : 0;
    s.brakeForce = s.brakeCyl * 1250 + electricBrake + parkingBrakeForce;
    const mass = 2800000; const resistance = 24000 + 60 * s.speed + 2 * s.speed * s.speed;
    const acceleration = (s.tractionForce - s.brakeForce - resistance) / mass;
    const actual = s.speed <= 0 && acceleration < 0 ? 0 : acceleration;
    s.speed = clamp(s.speed + actual * dt * 3.6, 0, s.limitedStart ? 15 : 120); s.distance += s.speed / 3.6 * dt;
    s.maxAcceleration = Math.max(s.maxAcceleration, Math.abs(actual)); s.maxJerk = Math.max(s.maxJerk, Math.abs((actual - s.lastAcceleration) / Math.max(dt, .01))); s.lastAcceleration = actual;
    if (s.scenarioId === 'weather' && s.credentialStage === 'limited-start' && s.distance >= ROUTE_CONTEXT.departureSignalDistance - 50) {
      s.credentialStage = 'confirm-ground-signal';
      this.emit('已接近地面出站信号机：请点击信号机确认地面信号是否与机车信号一致。');
    }
    if (!s.signalPassed && s.distance >= ROUTE_CONTEXT.departureSignalDistance) {
      s.signalPassed = true;
      this.emit('列车已越过地面出站信号机。');
    }
    if (s.lkjConfirmed && !s.lkjStartAttempted && s.speed >= 1 && s.distance > ROUTE_CONTEXT.departureSignalDistance + ROUTE_CONTEXT.lkjStartTolerance) {
      s.lkjStartAttempted = true;
      s.lkjStartCorrect = false;
      s.lkjStartError = 'missed';
      s.lkjStartDistance = s.distance;
      this.reject('已越过 LKJ 开车对标点，未按压【开车／7】键；本项错误已记录。');
    }
    if (s.signalPassed && !s.completed && s.distance >= ROUTE_CONTEXT.trainingEndDistance && s.speed >= 5) {
      s.completed = true;
      this.emit('已越过出站信号机后稳定运行 300 m，本次训练结束。');
    }
    this.emit();
  }
}
