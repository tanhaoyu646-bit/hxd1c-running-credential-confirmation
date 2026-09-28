import { TrainSimulation } from './dynamics.js?rev=lkj-nonnormal-v2-20260928';
import { PROCEDURE, procedureState, scoreRun } from './procedure.js?rev=lkj-nonnormal-v2-20260928';
import { MstsRouteScene } from './mstsRouteScene.js?rev=lkj-nonnormal-v2-20260928';
import { LKJ_FIELD_DEFINITIONS, RUNNING_NOTICES, SIGNAL_ASPECTS } from './scenario.js?rev=lkj-nonnormal-v2-20260928';
import { SCENARIOS, ROUTE_CONTEXT, getScenario, scenarioAudioPath } from './credentialScenario.js?rev=lkj-nonnormal-v2-20260928';

const $ = (q) => document.querySelector(q);
const sim = new TrainSimulation();
const overlay = $('#overlay');
const routeCanvas = $('#route-scene');
const routeScene = new MstsRouteScene(routeCanvas);
// 冷启动时首次 render 早于异步路线加载完成；ready 后必须重新同步画布与信号标注。
routeCanvas.addEventListener('route-ready',()=>render(sim.state));
routeCanvas.addEventListener('route-error',(event)=>{
  routeCanvas.classList.remove('live');
  const hint=$('#hint');
  if(hint)hint.textContent=`三维线路加载失败：${event.detail?.message||'请刷新页面重试'}`;
});
// route-error 已在页面提示，防止被浏览器重复报告为未处理的 Promise。
routeScene.loadPromise.catch(()=>{});
const views = { front: 'HXD1C_front.png', left: 'HXD1C_left_full.png', right: 'HXD1C_right_full.png' };
const debugMode = new URLSearchParams(location.search).get('debug') === '1';
const keys = [['lkj','LKJ确认'],['panto','前受电弓'],['main-breaker','主断合'],['compressor','压缩机'],['parking','停放缓解'],['headlight','前照灯'],['horn','风笛'],['reset','警惕/复位']];
let selectedView = 'front';
let activeDrag = null;
let hornPointerId = null;
let switchPanelRoot = null;
let switchPanelMessageTimer = null;
let powerCabinetRoot = null;
let lkjRoot = null;
let signalRoot = null;
let credentialRoot = null;
let resultRoot = null;
let resultShown = false;
let signalTarget = null;
let handSignalCard = null;
const INITIAL_CHECKS = [
  ['traction', '牵引手柄', '零位'], ['direction', '换向手柄', '中立位'],
  ['autoBrake', '自动制动阀', '运转位'], ['independentBrake', '单独制动阀', '缓解位'],
  ['parkingBrake', '停放制动', '施加'], ['panto', '受电弓', '降位'],
  ['mainBreaker', '主断路器', '分位'], ['compressor', '空压机', '停止'],
];
const hornAudio = new Audio('./assets/audio/HXD1C-horn.wav');
hornAudio.preload = 'auto'; hornAudio.loop = true;
const lkjKeyAudio = new Audio('./assets/audio/lkj-key.wav');
const stationAudio = {
  normal: new Audio(scenarioAudioPath('normal')),
  greenPermit: new Audio(scenarioAudioPath('greenPermit')),
  departure: new Audio(scenarioAudioPath('weather')),
};
Object.values(stationAudio).forEach((audio)=>{audio.preload='auto';});
const switchDefs = [
  { id:'main-breaker', label:'主断路器', type:'short', x:15.6, read:s=>s.mainBreaker, on:'合', off:'分', directional:true, initialCheck:'mainBreaker' },
  { id:'panto', label:'受电弓', type:'short', x:24.1, read:s=>s.panto, on:'升', off:'降', directional:true, initialCheck:'panto' },
  { id:'compressor', label:'空压机', type:'long', x:32.5, read:s=>s.compressor, on:'投入', off:'停止', directional:true, initialCheck:'compressor' },
  { id:'headlight', label:'前照灯', type:'round', x:40.6, read:s=>s.headlight, on:'开', off:'关' },
  { id:'auxiliary-light', label:'辅照灯', type:'slider', x:51.8, read:s=>s.auxiliaryLight, on:'全', off:'0' },
  { id:'marker-front', label:'标志灯（前）', type:'short', x:63.0, read:s=>s.markerFront, states:['0','white','red'] },
  { id:'marker-rear', label:'标志灯（后）', type:'short', x:72.2, read:s=>s.markerRear, states:['0','white','red'] },
  { id:'cab-light', label:'司机室灯', type:'long', x:81.5, read:s=>s.cabLight, on:'开', off:'关' },
];
const pct = (value,total) => `${value / total * 100}%`;
function frame(el, index, cols, rows) { const col = index % cols; const row = Math.floor(index / cols); el.style.backgroundPosition = `${cols === 1 ? 0 : col / (cols - 1) * 100}% ${rows === 1 ? 0 : row / (rows - 1) * 100}%`; }
function makeSprite(id, image, x, y, w, h, cols, rows, label) { const el=document.createElement('div'); el.className=`sprite ${id}`; el.dataset.id=id; el.title=label; el.style.left=pct(x,640); el.style.top=pct(y,480); el.style.width=pct(w,640); el.style.height=pct(h,480); el.style.backgroundImage=`url("./assets/archive-cabview/${image}")`; el.style.backgroundSize=`${cols*100}% ${rows*100}%`; overlay.append(el); return el; }
function makeTouchTarget(id, x, y, w, h, label) { const el=document.createElement('button'); el.type='button'; el.className=`touch-target ${id==='direction'?'direction-target':''}`; el.dataset.dragTarget=id; el.setAttribute('aria-label',label); el.style.left=pct(x,640); el.style.top=pct(y,480); el.style.width=pct(w,640); el.style.height=pct(h,480); overlay.append(el); return el; }
function makeHotspot(id,label,x,y,w,h) { const el=document.createElement('button'); el.className='hotspot'; el.dataset.id=id; el.dataset.label=label; el.style.left=pct(x,640); el.style.top=pct(y,480); el.style.width=pct(w,640); el.style.height=pct(h,480); el.addEventListener('click',()=>command(id)); overlay.append(el); return el; }
function makePhysicalButton(id,label,x,y,w,h,action) { const el=document.createElement('button'); el.type='button'; el.className=`physical-control-hotspot ${id}`; el.dataset.label=label; el.setAttribute('aria-label',label); el.style.left=pct(x,640); el.style.top=pct(y,480); el.style.width=pct(w,640); el.style.height=pct(h,480); if(action)action(el); else el.addEventListener('click',()=>command(id)); overlay.append(el); return el; }
function makeNeedle(id,image,x,y,w,h,pivot,start,end,kind='') { const el=document.createElement('span'); const color=image.includes('_red')?'red':''; el.className=`needle ${kind} ${color}`; el.dataset.id=id; el.dataset.start=start; el.dataset.end=end; el.setAttribute('aria-hidden','true'); el.style.left=pct(x,640); el.style.top=pct(y,480); el.style.width=pct(w,640); el.style.height=pct(h,480); el.style.transformOrigin=`50% ${pivot / h * 100}%`; overlay.append(el); return el; }
function makeBar(id,x,y,w,h,color='#5dffd5') { const el=document.createElement('div'); el.className='gauge-bar'; el.dataset.id=id; el.style.left=pct(x,640); el.style.top=pct(y,480); el.style.width=pct(w,640); el.style.height=pct(h,480); el.style.background=color; overlay.append(el); return el; }
function makeDigital(id,x,y,w,h,kind='') { const el=document.createElement('div'); el.className=`digital ${kind}`; el.dataset.id=id; el.style.left=pct(x,640); el.style.top=pct(y,480); el.style.width=pct(w,640); el.style.height=pct(h,480); overlay.append(el); return el; }
function makePositionBadge(id,label,x,y,w=82) { const el=document.createElement('button');const checkId={auto:'autoBrake',independent:'independentBrake',traction:'traction',direction:'direction'}[id];el.type='button';el.className='control-position-badge';el.dataset.positionId=id;el.setAttribute('aria-label',`核对${label}初始位置`);el.style.left=pct(x,640);el.style.top=pct(y,480);el.style.width=pct(w,640);el.innerHTML=`<b>${label}</b><span>—</span>`;el.addEventListener('click',(event)=>{event.preventDefault();if(!sim.state.lkjConfirmed)command('initial-inspect',checkId);});overlay.append(el);return el; }
function makeStateSprite(id,image,x,y,w,h,cols,rows) { const el=document.createElement('div'); el.className=id==='signal'?'signal-sprite':'panto-sprite'; el.dataset.id=id; el.style.left=pct(x,640); el.style.top=pct(y,480); el.style.width=pct(w,640); el.style.height=pct(h,480); el.style.backgroundImage=`url("./assets/archive-cabview/${image}")`; el.style.backgroundSize=`${cols*100}% ${rows*100}%`; overlay.append(el); return el; }
function setNeedle(el,value,max) { const safe=Number.isFinite(Number(value))?Number(value):0;const ratio=Math.max(0,Math.min(1,safe/max)); const start=Number(el.dataset.start); const end=Number(el.dataset.end); el.style.transform=`rotate(${start+(end-start)*ratio}deg)`; }
// 原贴图从前推端到后拉端依次为：牵引最大(frame 0) → 零位(frame 7) → 电制动最大(frame 15)。
function tractionFrame(value) { return value > 0 ? Math.max(0,7-Math.min(7,value)) : value === 0 ? 7 : Math.min(15,7+Math.min(8,Math.abs(value))); }
let elements={};
function startDrag(id, el, event) {
  event.preventDefault();
  const range=id==='traction'?15:5;
  activeDrag={id,pointerId:event.pointerId,startY:event.clientY,start:sim.state[id==='auto'?'autoBrake':id==='independent'?'independentBrake':'traction'],pixelsPerStep:Math.max(8,el.getBoundingClientRect().height/range)};
  try{event.currentTarget.setPointerCapture?.(event.pointerId);}catch{ /* 部分 iOS WebKit 不开放指针捕获，窗口级监听仍可完成拖动。 */ }
}
function createFront() {
  overlay.replaceChildren(); elements={};
  signalTarget=document.createElement('button');signalTarget.type='button';signalTarget.className='signal-trigger';signalTarget.setAttribute('aria-label','点击地面出站信号机进行确认');signalTarget.addEventListener('click',(event)=>{event.stopPropagation();openSignalInspection();});overlay.append(signalTarget);
  handSignalCard=document.createElement('section');handSignalCard.className='hand-signal-card';handSignalCard.setAttribute('aria-live','polite');handSignalCard.innerHTML='<b>确认发车手信号</b><video controls loop playsinline preload="metadata"><source src="./assets/video/AnimateDiff_00392-audio.mp4" type="video/mp4"></video><p>请观察发车手信号，确认显示正确后点击下方按钮。</p><button type="button" class="hand-signal-confirm">已确认发车手信号</button>';handSignalCard.querySelector('.hand-signal-confirm').addEventListener('click',()=>command('hand-signal-confirm'));overlay.append(handSignalCard);
  elements.auto=makeSprite('auto-brake','HXD1C_DZ.png',35,341,45,60,4,3,'自动制动阀（拖动）');
  elements.independent=makeSprite('independent-brake','HXD1C_XZ.png',138,341,35,60,4,3,'单独制动阀（拖动）');
  elements.traction=makeSprite('traction','HXD1C_GL.png',464,345,46,81,2,8,'牵引/电制动手柄（拖动）');
  elements.direction=makeSprite('direction','HXD1C_HX.png',530,366,60,40,3,1,'方向手柄（点击切换）'); elements.direction.classList.add('direction'); elements.direction.addEventListener('click',()=>command('direction'));
  // 原 CVF 没有为中部板钮定义鼠标热区；不再用猜测坐标冒充真实按钮。
  // 电气与辅助设备通过右侧经过命名校验的操作按钮控制，车内只保留 CVF 明确定义的复位热区。
  elements.reset=makeHotspot('reset','警惕/复位',386,312,32,32);
  makePhysicalButton('lkj-trigger','放大 LKJ 监控装置',210,226,101,94,(el)=>el.addEventListener('click',openLkj));
  elements.parkingApply=makePhysicalButton('parking-apply','停放制动施加（红）',157,350,21,29,(el)=>el.addEventListener('click',()=>{if(command('parking-apply')&&!sim.state.lkjConfirmed)command('initial-inspect','parkingBrake');}));
  elements.parkingRelease=makePhysicalButton('parking-release','停放制动缓解（绿）',179,350,22,29);
  elements.hornButton=makePhysicalButton('horn-button','风笛（按住）',577,408,37,39,(el)=>{
    el.addEventListener('pointerdown',(event)=>{event.preventDefault();hornPointerId=event.pointerId;el.classList.add('pressed');command('horn-start');hornAudio.currentTime=0;hornAudio.play().catch(()=>{});try{el.setPointerCapture(event.pointerId);}catch{}});
  });
  elements.autoPosition=makePositionBadge('auto','自阀',20,321,80);
  elements.independentPosition=makePositionBadge('independent','单阀',118,321,76);
  elements.tractionPosition=makePositionBadge('traction','牵引手柄',438,323,86);
  elements.directionPosition=makePositionBadge('direction','换向手柄',521,342,88);
  const switchPanelTrigger=document.createElement('button');
  switchPanelTrigger.type='button';switchPanelTrigger.className='switch-panel-trigger';switchPanelTrigger.setAttribute('aria-label','放大中部板钮面板');
  switchPanelTrigger.style.left=pct(232,640);switchPanelTrigger.style.top=pct(337,480);switchPanelTrigger.style.width=pct(165,640);switchPanelTrigger.style.height=pct(43,480);
  switchPanelTrigger.addEventListener('click',(event)=>{event.preventDefault();openSwitchPanel();});overlay.append(switchPanelTrigger);
  // 原 CVF 中的动态指针：两套风压表、速度表、网压与四路电流条。
  elements.speedNeedle=makeNeedle('speed-needle','HXD1C_SDZ.png',493,277,3,18,2,68,300,'speed');
  elements.mainNeedle=makeNeedle('main-needle','HXD1C_red.png',154,253,7,21,14,230,100);
  elements.pipeNeedle=makeNeedle('pipe-needle','HXD1C_black.png',154,253,7,21,14,230,130);
  elements.eqNeedle=makeNeedle('eq-needle','HXD1C_black.png',162,295,7,21,14,224,136);
  elements.cylNeedle=makeNeedle('cyl-needle','HXD1C_red.png',162,295,7,21,14,230,130);
  elements.mainNeedle2=makeNeedle('main-needle-2','HXD1C_PPW.png',75,299,7,18,1,3,358);
  elements.pipeNeedle2=makeNeedle('pipe-needle-2','HXD1C_PPR.png',75,299,7,18,1,3,336);
  elements.eqNeedle2=makeNeedle('eq-needle-2','HXD1C_PPW.png',36,312,7,18,1,3,336);
  elements.cylNeedle2=makeNeedle('cyl-needle-2','HXD1C_PPR.png',36,312,7,18,1,3,300);
  elements.voltageBar=makeBar('voltage-bar',351,266,4,30,'#56e9aa');
  elements.currentBars=[makeBar('current-1',362,266,4,30),makeBar('current-2',370,266,4,30),makeBar('current-3',381,266,4,30),makeBar('current-4',388,266,4,30)];
  elements.speedDigital=makeDigital('speed-digital',229,251,20,7);
  elements.limitDigital=makeDigital('limit-digital',244,251,20,7,'limit');
  elements.clockDigital=makeDigital('clock-digital',230,268,45,10,'clock');
  elements.pantoDisplay=makeStateSprite('panto','HXD1C_DG.png',410,295,7,8,1,2);
  elements.signal=makeStateSprite('signal','HXD1C_jx.png',540,0,100,162,4,2);
  for(const [id,el] of [['auto',elements.auto],['independent',elements.independent],['traction',elements.traction]]) el.addEventListener('pointerdown',(event)=>startDrag(id,el,event));
  // 原图控件保持原比例，另加透明的大触控区，避免手机上手指遮住并按不中小手柄。
  const touchControls=[
    ['auto',elements.auto,23,326,70,91,'拖动自动制动阀'],
    ['independent',elements.independent,122,326,66,91,'拖动单独制动阀'],
    ['traction',elements.traction,447,326,80,116,'拖动牵引和电制动手柄'],
  ];
  for(const [id,target,x,y,w,h,label] of touchControls){const zone=makeTouchTarget(id,x,y,w,h,label);zone.addEventListener('pointerdown',(event)=>startDrag(id,target,event));}
  const directionZone=makeTouchTarget('direction',516,350,88,70,'切换方向手柄');
  directionZone.addEventListener('click',(event)=>{event.preventDefault();command('direction');});
  elements.traction.addEventListener('dblclick',(event)=>{event.preventDefault();command('traction',0);});
}
function command(id,value) { const s=sim.state; if(id==='direction'&&value===undefined) value=s.direction==='N'?'F':s.direction==='F'?'R':'N'; return sim.command(id,value); }
function buildPowerCabinet(){
  const root=document.createElement('div');root.className='device-modal power-cabinet-modal';root.setAttribute('aria-hidden','true');
  root.innerHTML=`<div class="device-shell power-cabinet-shell" role="dialog" aria-modal="true" aria-label="HXD1C控制电源柜"><div class="device-head"><div><strong>HXD1C 控制电源柜</strong><span>按发车准备要求依次接通三项电源</span></div><button type="button" class="device-close" aria-label="关闭">×</button></div><div class="cabinet-face"><div class="cabinet-meter"><span>控制电压</span><b data-cabinet-voltage>0 V</b></div><div class="cabinet-lamps"><i data-lamp="110"></i><span>110V</span><i data-lamp="24"></i><span>24V</span></div><div class="cabinet-switches"></div><p class="cabinet-note">三项均接通后，司机室控制电源才建立。任何一项断开，主断与空压机均退出。</p></div></div>`;
  const defs=[['controlPowerOutput','控制电源输出'],['parkingPower','停放制动电源'],['output24V','24V 输出']];
  const box=root.querySelector('.cabinet-switches');
  for(const [key,label] of defs){const b=document.createElement('button');b.type='button';b.className='cabinet-switch';b.dataset.powerKey=key;b.innerHTML=`<span class="cabinet-toggle"><i></i></span><strong>${label}</strong><em>断开</em>`;b.addEventListener('click',()=>{const accepted=command('power-cabinet-switch',{key,enabled:!sim.state[key]});if(accepted)navigator.vibrate?.(18);syncPowerCabinet(sim.state);});box.append(b);}
  root.querySelector('.device-close').addEventListener('click',closePowerCabinet);root.addEventListener('click',(event)=>{if(event.target===root)closePowerCabinet();});document.body.append(root);powerCabinetRoot=root;syncPowerCabinet(sim.state);
}
function syncPowerCabinet(state){if(!powerCabinetRoot)return;for(const b of powerCabinetRoot.querySelectorAll('.cabinet-switch')){const on=Boolean(state[b.dataset.powerKey]);b.classList.toggle('on',on);b.querySelector('em').textContent=on?'接通':'断开';b.setAttribute('aria-pressed',String(on));}powerCabinetRoot.querySelector('[data-cabinet-voltage]').textContent=state.powerOn?'110 V':'0 V';powerCabinetRoot.querySelector('[data-lamp="110"]').classList.toggle('on',state.controlPowerOutput&&state.parkingPower);powerCabinetRoot.querySelector('[data-lamp="24"]').classList.toggle('on',state.output24V);}
function openPowerCabinet(){if(!powerCabinetRoot)buildPowerCabinet();closeLkj();closeSwitchPanel();powerCabinetRoot.classList.add('open');powerCabinetRoot.setAttribute('aria-hidden','false');document.body.classList.add('device-panel-active');syncPowerCabinet(sim.state);}
function closePowerCabinet(){if(!powerCabinetRoot)return;powerCabinetRoot.classList.remove('open');powerCabinetRoot.setAttribute('aria-hidden','true');document.body.classList.remove('device-panel-active');}

const lkjFields=LKJ_FIELD_DEFINITIONS;
const lkjKeyDefs=[
  ['alarm','警惕',134,532,52,57],['unlock','解锁',187,510,50,40],['relief','缓解',187,550,50,40],
  ['digit-1','向前／1',238,510,51,40],['digit-6','向后／6',238,550,51,40],['digit-2','调车／2',290,510,51,40],['digit-7','开车／7',290,550,51,40],
  ['digit-3','车位／3',343,510,51,40],['digit-8','自动校正／8',343,550,51,40],['digit-4','进路号／4',395,510,51,40],['digit-9','出入库／9',395,550,51,40],
  ['digit-5','定标／5',447,510,51,40],['digit-0','巡检／0',447,550,51,40],['query','查询',499,510,53,40],['left','左箭头／删除',499,550,53,40],
  ['up','上箭头',553,510,51,40],['down','下箭头',553,550,51,40],['dump','转储',604,510,50,40],['right','右箭头／确认',604,550,50,40],
];
const LKJ_NONNORMAL_OPTIONS=[
  ['groundSignal','地面信号确认'],['greenPermit','绿色许可证'],['routeTicket','路票'],
  ['limit20','转入20km/h限速模式'],['freightAdvance','货车特殊前行'],['modeSelect','模式选择'],['return','返回'],
];
let lkjDraft={};let lkjFieldIndex=0;let lkjPhase='boot';let lkjNotice='';let lkjNoticeIndex=0;
let lkjUnlockDraft={};let lkjUnlockFieldIndex=0;let lkjMenuIndex=0;let lkjUpHoldTimer=null;let lkjUpHoldTriggered=false;let lkjUnlockArmedUntil=0;
function lkjOperational(){return sim.state.lkjConfirmed||(sim.state.trainingMode==='assessment'&&sim.state.lkjAttempted);}
function buildLkj(){
  const root=document.createElement('div');root.className='device-modal lkj-modal';root.setAttribute('aria-hidden','true');
  root.innerHTML=`<div class="device-shell lkj-shell" role="dialog" aria-modal="true" aria-label="LKJ2000监控装置"><div class="device-head"><div><strong>LKJ2000 监控装置</strong><span>输入参数并核对运行揭示</span></div><button type="button" class="device-close" aria-label="关闭">×</button></div><div class="lkj-device"><img src="./assets/lkj/LKJ2000.png" alt="LKJ2000设备面板"><div class="lkj-screen"></div><div class="lkj-keypad"></div></div></div>`;
  root.querySelector('.device-close').addEventListener('click',closeLkj);root.addEventListener('click',(event)=>{if(event.target===root)closeLkj();});
  const keypad=root.querySelector('.lkj-keypad');
  for(const [id,label,x,y,w,h] of lkjKeyDefs){const button=document.createElement('button');button.type='button';button.dataset.lkjKey=id;button.setAttribute('aria-label',label);button.style.left=pct(x,800);button.style.top=pct(y,600);button.style.width=pct(w,800);button.style.height=pct(h,600);const release=()=>{button.classList.remove('pressed');if(id==='up'){clearTimeout(lkjUpHoldTimer);lkjUpHoldTimer=null;}};button.addEventListener('pointerdown',()=>{button.classList.add('pressed');if(id==='up'&&lkjOperational()&&lkjPhase==='done'){clearTimeout(lkjUpHoldTimer);lkjUpHoldTriggered=false;lkjUpHoldTimer=setTimeout(()=>{lkjUpHoldTriggered=true;openLkjNonnormalMenu();},2000);}});button.addEventListener('pointerup',release);button.addEventListener('pointercancel',release);button.addEventListener('pointerleave',release);button.addEventListener('click',()=>{if(id==='up'&&lkjUpHoldTriggered){lkjUpHoldTriggered=false;return;}handleLkjKey(id);});keypad.append(button);}
  document.body.append(root);lkjRoot=root;renderLkj();
}
function playLkjKey(){try{lkjKeyAudio.currentTime=0;lkjKeyAudio.play().catch(()=>{});}catch{}}
function flashLkj(message){lkjNotice=message;renderLkj();const screen=lkjRoot?.querySelector('.lkj-screen');screen?.classList.add('error');setTimeout(()=>{if(lkjNotice===message){lkjNotice='';renderLkj();}},900);}
function openLkjNonnormalMenu(){
  playLkjKey();navigator.vibrate?.(24);const scenario=getScenario(sim.state.scenarioId);
  if(!scenario.requiresLkjUnlock&&!sim.isAssessment()){flashLkj('当前场景不需要非正常行车确认。');return;}
  if(!sim.state.credentialAttempted&&!sim.isAssessment()){flashLkj('请先取得并核对本场景行车凭证。');return;}
  lkjMenuIndex=Math.max(0,LKJ_NONNORMAL_OPTIONS.findIndex(([key])=>key===scenario.lkjUnlockMethod));lkjPhase='nonnormal-menu';lkjNotice='';renderLkj();
}
function handleLkjKey(id){
  playLkjKey();navigator.vibrate?.(12);
  if(lkjPhase==='nonnormal-menu'){
    if(id==='up'){lkjMenuIndex=(lkjMenuIndex-1+LKJ_NONNORMAL_OPTIONS.length)%LKJ_NONNORMAL_OPTIONS.length;renderLkj();return;}
    if(id==='down'){lkjMenuIndex=(lkjMenuIndex+1)%LKJ_NONNORMAL_OPTIONS.length;renderLkj();return;}
    if(id==='left'||id==='relief'){lkjPhase='done';renderLkj();return;}
    if(id==='right'){
      const [method]=LKJ_NONNORMAL_OPTIONS[lkjMenuIndex];if(method==='return'){lkjPhase='done';renderLkj();return;}
      const accepted=sim.command('lkj-special-method',method);if(!accepted){renderLkj();return;}
      const scenario=getScenario(sim.state.scenarioId);lkjUnlockDraft={...(sim.state.lkjUnlockData||{})};lkjUnlockFieldIndex=0;lkjPhase='nonnormal-input';lkjNotice='';renderLkj();return;
    }
    flashLkj('使用【↑↓】选择，【确认】进入。');return;
  }
  if(lkjPhase==='nonnormal-input'){
    const selectedScenario=sim.state.lkjUnlockMethod==='greenPermit'?SCENARIOS.greenPermit:sim.state.lkjUnlockMethod==='routeTicket'?SCENARIOS.routeTicket:null;const fields=selectedScenario?.lkjUnlockFields||[];const [key]=fields[lkjUnlockFieldIndex]||[];const value=String(lkjUnlockDraft[key]||'');const digit=id.startsWith('digit-')?id.slice(6):'';
    if(digit&&key){if(value.length<10)lkjUnlockDraft[key]=value+digit;renderLkj();return;}
    if(id==='left'&&key){lkjUnlockDraft[key]=value.slice(0,-1);renderLkj();return;}
    if(id==='up'){lkjUnlockFieldIndex=Math.max(0,lkjUnlockFieldIndex-1);renderLkj();return;}
    if(id==='down'){lkjUnlockFieldIndex=Math.min(fields.length-1,lkjUnlockFieldIndex+1);renderLkj();return;}
    if(id==='relief'){lkjPhase='nonnormal-menu';renderLkj();return;}
    if(id==='right'){
      if(fields.some(([field])=>!String(lkjUnlockDraft[field]||'').trim())){flashLkj('调度命令号和凭证号码必须填写完整。');return;}
      const accepted=sim.command('lkj-special-input',lkjUnlockDraft);if(accepted){lkjPhase='nonnormal-arm';lkjUnlockArmedUntil=0;}renderLkj();return;
    }
    flashLkj('数字键输入，【←】删除，【↑↓】换项，【确认】提交。');return;
  }
  if(lkjPhase==='nonnormal-arm'){
    if(id==='unlock'){lkjUnlockArmedUntil=performance.now()+2000;lkjNotice='解锁键已按下，请在2秒内按【确认】';renderLkj();return;}
    if(id==='right'){
      const combined=performance.now()<=lkjUnlockArmedUntil;const accepted=sim.command('lkj-special-unlock',combined);
      if(accepted){lkjPhase='done';lkjUnlockArmedUntil=0;lkjNotice='';renderLkj();closeLkj();openCredentialModal();}else{lkjUnlockArmedUntil=0;renderLkj();}return;
    }
    if(id==='left'||id==='relief'){lkjPhase='nonnormal-input';renderLkj();return;}
    flashLkj('先按【解锁】，再在2秒内按【确认】。');return;
  }
  if(lkjOperational()&&id==='digit-7'){sim.command('lkj-start');renderLkj();return;}
  if(lkjOperational()){if(id==='query')lkjPhase='review';else if(lkjPhase==='review'&&(id==='left'||id==='relief'||id==='right'||id==='query'))lkjPhase='done';renderLkj();return;}
  if(lkjPhase==='boot'){if(id==='query'||id==='right'){lkjPhase='edit';lkjFieldIndex=0;renderLkj();}else flashLkj('请按【查询】进入参数设定');return;}
  if(lkjPhase==='edit'){
    const [key]=lkjFields[lkjFieldIndex];const value=lkjDraft[key]||'';const digit=id.startsWith('digit-')?id.slice(6):'';
    if(digit){if(value.length<10)lkjDraft[key]=value+digit;renderLkj();return;}
    if(id==='left'){lkjDraft[key]=value.slice(0,-1);renderLkj();return;}
    if(id==='unlock'){lkjDraft[key]='';renderLkj();return;}
    if(id==='up'||id==='relief'){lkjFieldIndex=Math.max(0,lkjFieldIndex-1);renderLkj();return;}
    if(id==='down'){lkjFieldIndex=Math.min(lkjFields.length-1,lkjFieldIndex+1);renderLkj();return;}
    if(id==='query'){if(lkjFields.some(([field])=>!lkjDraft[field]))flashLkj('参数尚未填写完整');else{lkjPhase='review';renderLkj();}return;}
    if(id==='right'){if(!value){flashLkj('本项不能为空');return;}if(lkjFieldIndex<lkjFields.length-1)lkjFieldIndex+=1;else lkjPhase='review';renderLkj();return;}
    flashLkj('当前为参数输入状态');return;
  }
  if(lkjPhase==='review'){if(id==='left'||id==='up'||id==='relief'){lkjPhase='edit';renderLkj();return;}if(id==='right'||id==='query'){lkjPhase='reveal';lkjNoticeIndex=0;renderLkj();return;}flashLkj('按【→】进入揭示核对');return;}
  if(lkjPhase==='reveal'){
    if(id==='left'||id==='relief'){lkjPhase='review';renderLkj();return;}
    if(id==='right'||id==='query'){
      if(lkjNoticeIndex<RUNNING_NOTICES.length-1){lkjNoticeIndex+=1;renderLkj();return;}
      if(command('lkj-confirm',lkjDraft)){lkjPhase='done';renderLkj();}return;
    }
    flashLkj('按【→】逐条核对运行揭示');
  }
}
function renderLkj(){
  if(!lkjRoot)return;const screen=lkjRoot.querySelector('.lkj-screen');
  const scenario=getScenario(sim.state.scenarioId);
  if(lkjPhase==='nonnormal-menu'){
    screen.innerHTML=`<b>非正常行车确认</b><span>请选择确认方式：</span><div class="lkj-menu">${LKJ_NONNORMAL_OPTIONS.map(([key,label],index)=>`<span class="${index===lkjMenuIndex?'selected':''}">${index===LKJ_NONNORMAL_OPTIONS.length-1?'0':index+1}. ${label}</span>`).join('')}</div><span class="lkj-help">【↑↓】选择　【确认】进入　【←】返回</span>`;return;
  }
  if(lkjPhase==='nonnormal-input'){
    const selectedScenario=sim.state.lkjUnlockMethod==='greenPermit'?SCENARIOS.greenPermit:sim.state.lkjUnlockMethod==='routeTicket'?SCENARIOS.routeTicket:null;const fields=selectedScenario?.lkjUnlockFields||[];const [, ,target]=fields[lkjUnlockFieldIndex]||['','凭证号码',''];
    screen.innerHTML=`<b>${selectedScenario?.lkjUnlockLabel||'所选方式'}输入</b><span>所属车站：株洲站</span><div class="lkj-review">${fields.length?fields.map(([field,name],index)=>`<span class="${index===lkjUnlockFieldIndex?'selected':''}">${name}</span><strong class="${index===lkjUnlockFieldIndex?'selected':''}">${lkjUnlockDraft[field]||'_'}</strong>`).join(''):'<span>该方式无编号输入项</span><strong>—</strong>'}</div><span class="lkj-help">${sim.state.trainingMode==='teaching'&&target?`教学值：${target}<br>`:''}数字键输入　【←】删除　【↑↓】换项　【确认】提交</span>`;return;
  }
  if(lkjPhase==='nonnormal-arm'){
    const limit=scenario.lkjUnlockLimit||0;const armed=performance.now()<=lkjUnlockArmedUntil;
    screen.innerHTML=`<b>${scenario.lkjUnlockLabel}确认</b><span>${(scenario.lkjUnlockFields||[]).map(([key,label])=>`${label} ${lkjUnlockDraft[key]||'—'}`).join('　')}</span><strong class="${armed?'lkj-ok':'lkj-start-ready'}">${armed?'解锁键已按下':'等待组合解锁'}</strong><span class="lkj-help">正确后模式限速 ${limit} km/h<br>${armed?'请立即按【确认】':'先按【解锁】，再在2秒内按【确认】'}${lkjNotice?`<br>${lkjNotice}`:''}</span>`;return;
  }
  if(lkjOperational()&&lkjPhase!=='review'){
    const start=sim.state.lkjStartCorrect;
    const error=sim.state.lkjStartError;
    const remaining=Math.round(ROUTE_CONTEXT.departureSignalDistance-sim.state.distance);
    const status=start?'LKJ 正常监控':error==='missed'||error==='late'?'开车对标错误已记录':'开车对标待执行';
    const detail=start?'已在规定对标点按压【开车／7】键。':error==='stationary'?'列车尚未起动，不能开车对标。':error==='early'?`距开车对标点约 ${Math.max(0,remaining)} m。`:error==='late'||error==='missed'?'已越过对标点，本项按错误记录。':`列车起动后，在出站信号机对标点按压【开车／7】键。`;
    const limit=sim.state.lkjUnlockCorrect&&sim.state.lkjUnlockLimit?sim.state.lkjUnlockLimit:scenario.requiresLkjUnlock?20:30;
    screen.innerHTML=`<b>监控状态</b><div class="lkj-monitor-grid"><span>速度</span><strong>${sim.state.speed.toFixed(1)} km/h</strong><span>限速</span><strong>${limit} km/h</strong><span>距出站信号</span><strong>${Math.max(0,remaining)} m</strong><span>车次</span><strong>${sim.state.lkjData?.trainNo||'—'}</strong></div><strong class="${start?'lkj-ok':error?'lkj-start-error':'lkj-start-ready'}">${status}</strong><span class="lkj-help">${detail}<br>长按【↑】2秒进入非正常行车确认；按【查询】查看参数${lkjNotice?`<br>${lkjNotice}`:''}</span>`;return;
  }
  if(lkjPhase==='done'&&sim.state.lkjAttempted){screen.innerHTML=`<b>参数核对记录</b><span>本次输入存在 ${sim.state.lkjErrors.length} 项不一致</span><strong>考评已记录，允许继续后续作业</strong><span class="lkj-help">本项将在成绩单中按实际正确性计分；按【查询】可重新输入。</span>`;return;}
  if(lkjPhase==='boot'){screen.innerHTML='<b>LKJ2000</b><span>设备自检正常</span><strong>按【查询】进入参数设定</strong><span class="lkj-help">使用显示器下方实体键操作</span>';return;}
  if(lkjPhase==='edit'){
    const [key,label,target]=lkjFields[lkjFieldIndex];const value=lkjDraft[key]||'';screen.innerHTML=`<b>参数输入 ${lkjFieldIndex+1}/${lkjFields.length}</b><span>${label}</span><strong class="lkj-input">${value||'_'}</strong>`;
    screen.insertAdjacentHTML('beforeend',`<span class="lkj-help">训练值：${target}<br>数字键输入　【←】删除　【↑↓】换项　【→】确认${lkjNotice?`<br>${lkjNotice}`:''}</span>`);return;
  }
  if(lkjPhase==='review'){screen.innerHTML=`<b>参数核对</b><div class="lkj-review">${lkjFields.map(([key,label])=>`<span>${label}</span><strong>${lkjDraft[key]||'—'}</strong>`).join('')}</div><span class="lkj-help">【←】返回修改　【→】进入揭示核对${lkjNotice?`<br>${lkjNotice}`:''}</span>`;return;}
  const last=lkjNoticeIndex===RUNNING_NOTICES.length-1;
  screen.innerHTML=`<b>运行揭示 ${lkjNoticeIndex+1}/${RUNNING_NOTICES.length}</b><span>${RUNNING_NOTICES[lkjNoticeIndex]}</span><strong>${last?'按【→】确认并投入监控':'按【→】查看下一条揭示'}</strong><span class="lkj-help">【←】返回参数${lkjNotice?`<br>${lkjNotice}`:''}</span>`;
}
function openLkj(mode='normal'){if(!lkjRoot)buildLkj();closeSwitchPanel();closeSignalInspection();closeCredentialModal();lkjPhase=lkjOperational()?'done':'boot';lkjUnlockDraft={...(sim.state.lkjUnlockData||{})};lkjUnlockFieldIndex=0;lkjUnlockArmedUntil=0;lkjNoticeIndex=0;lkjNotice=mode==='special-unlock'?'请在监控主界面持续按压【↑】键2秒。':'';lkjDraft=sim.state.lkjData&&!sim.state.lkjData.debug?{...sim.state.lkjData}:{};lkjRoot.classList.add('open');lkjRoot.setAttribute('aria-hidden','false');document.body.classList.add('device-panel-active');renderLkj();}
function closeLkj(){if(!lkjRoot)return;clearTimeout(lkjUpHoldTimer);lkjUpHoldTimer=null;lkjRoot.classList.remove('open');lkjRoot.setAttribute('aria-hidden','true');document.body.classList.remove('device-panel-active');}
function buildSignalInspection(){
  const root=document.createElement('div');root.className='device-modal signal-modal';root.setAttribute('aria-hidden','true');
  root.innerHTML=`<div class="device-shell signal-shell" role="dialog" aria-modal="true" aria-label="侧线矮型出站色灯信号机确认"><div class="device-head"><div><strong>侧线矮型出站色灯信号机</strong><span>观察线路左侧实体信号机后，选择对应信号及其含义</span></div><button type="button" class="device-close" aria-label="关闭">×</button></div><div class="signal-inspection-body"><div class="signal-lens"><div class="dwarf-signal-preview" aria-label="矮型出站色灯信号机放大图"><div class="signal-main-stack"><i data-dwarf-lamp="green"></i><i data-dwarf-lamp="yellow"></i><i data-dwarf-lamp="greenLower"></i></div><i class="signal-red" data-dwarf-lamp="red"></i><b>出站</b></div></div><div class="signal-observation"><b data-signal-question>请选择所见信号</b><p data-signal-meaning>四显示自动闭塞课堂训练</p><div class="signal-answer-buttons"></div><small>红灯仅用于教学讲解，禁止越过该信号机。</small></div></div></div>`;
  const buttons=root.querySelector('.signal-answer-buttons');
  for(const key of ['green','greenYellow','yellow','red']){const b=document.createElement('button');b.type='button';b.dataset.signalAnswer=key;b.textContent=SIGNAL_ASPECTS[key].label;b.addEventListener('click',()=>{
    const accepted=command('signal-answer',key);renderSignalInspection(sim.state);
    if(accepted)closeSignalInspection();
  });buttons.append(b);}
  root.querySelector('.device-close').addEventListener('click',closeSignalInspection);root.addEventListener('click',(event)=>{if(event.target===root)closeSignalInspection();});document.body.append(root);signalRoot=root;renderSignalInspection(sim.state);
}
function renderSignalInspection(state){
  if(!signalRoot)return;const aspect=SIGNAL_ASPECTS[state.signalAspect];const lit={green:['green'],greenYellow:['greenLower','yellow'],yellow:['yellow'],red:['red']}[state.signalAspect]||[];
  signalRoot.querySelectorAll('[data-dwarf-lamp]').forEach((lamp)=>lamp.classList.toggle('lit',lit.includes(lamp.dataset.dwarfLamp)));
  const scenario=getScenario(state.scenarioId);
  const weatherUnreadable=scenario.id==='weather'&&state.distance<ROUTE_CONTEXT.departureSignalDistance-ROUTE_CONTEXT.weatherSignalClearDistance;
  const weatherAwaiting=scenario.id==='weather'&&state.credentialStage==='confirm-ground-signal';
  const recorded=state.signalObserved&&state.trainingMode==='assessment'&&!state.signalMeaningCorrect;
  signalRoot.classList.toggle('weather-unreadable',weatherUnreadable);
  signalRoot.querySelector('[data-signal-question]').textContent=weatherUnreadable?'地面信号暂无法辨认':recorded?`已记录错误：所选${SIGNAL_ASPECTS[state.signalAnswer]?.label||'未知'}`:state.signalObserved&&state.signalMeaningCorrect?`已确认：${aspect.label}`:weatherAwaiting?'确认地面信号是否与机车信号一致':'请选择所见信号';
  signalRoot.querySelector('[data-signal-meaning]').textContent=weatherUnreadable?`当前距出站信号机约 ${Math.ceil(ROUTE_CONTEXT.departureSignalDistance-state.distance)} m；应按机车信号低速运行，接近后再确认地面显示。`:recorded?`实际显示为${aspect.label}；考评流程继续，本项按实际正确性计分。`:state.signalObserved&&state.signalMeaningCorrect?aspect.meaning:weatherAwaiting?'不一致时必须立即停车。':'正常场景须先接收车站联控，再确认出站信号。';
  for(const b of signalRoot.querySelectorAll('[data-signal-answer]')){b.classList.toggle('selected',b.dataset.signalAnswer===state.signalAnswer&&state.signalObserved);b.disabled=weatherUnreadable;}
}
function openSignalInspection(){if(!signalRoot)buildSignalInspection();closeLkj();closeSwitchPanel();closeCredentialModal();signalRoot.classList.add('open');signalRoot.setAttribute('aria-hidden','false');document.body.classList.add('device-panel-active');renderSignalInspection(sim.state);}
function closeSignalInspection(){if(!signalRoot)return;signalRoot.classList.remove('open');signalRoot.setAttribute('aria-hidden','true');document.body.classList.remove('device-panel-active');}
function playStationAudio(kind){
  const audio=stationAudio[kind];if(!audio)return;
  try{audio.pause();audio.currentTime=0;audio.play().catch(()=>{});}catch{}
}
function buildCredentialModal(){
  const root=document.createElement('div');root.className='device-modal credential-modal';root.setAttribute('aria-hidden','true');
  root.innerHTML=`<div class="device-shell credential-shell" role="dialog" aria-modal="true" aria-label="行车凭证确认"><div class="device-head"><div><strong>确认行车凭证</strong><span>仅播放车站侧联控录音；学生通过文字操作完成应答与核对。</span></div><button type="button" class="device-close" aria-label="关闭">×</button></div><div class="credential-body"></div></div>`;
  root.querySelector('.device-close').addEventListener('click',closeCredentialModal);root.addEventListener('click',(event)=>{if(event.target===root)closeCredentialModal();});document.body.append(root);credentialRoot=root;
}
function openCredentialModal(){if(!credentialRoot)buildCredentialModal();closeLkj();closeSignalInspection();credentialRoot.classList.add('open');credentialRoot.setAttribute('aria-hidden','false');document.body.classList.add('device-panel-active');renderCredentialModal(sim.state);}
function closeCredentialModal(){if(!credentialRoot)return;credentialRoot.classList.remove('open');credentialRoot.setAttribute('aria-hidden','true');document.body.classList.remove('device-panel-active');}
function credentialAction(label,action,kind=''){return `<button type="button" class="credential-action" data-credential-action="${action}" data-audio-kind="${kind}">${label}</button>`;}
function credentialDocument(scenario,type='credential'){
  if(type==='order'){
    return `<section class="credential-document dispatch-order"><h3>调　度　命　令</h3><div class="dispatch-order-no">2026年　月　日　　第${scenario.orderNumber}号</div><div class="dispatch-order-meta"><span>受令处所</span><b>株洲站</b><span>调度员姓名</span><b>教学调度员</b></div><div class="dispatch-order-content"><b>命令内容</b><p>${scenario.orderText}</p></div><div class="dispatch-order-sign">株洲站（站名印）　车站值班员：教学值班员</div></section>`;
  }
  if(scenario.documentType==='green-permit'){
    return `<section class="credential-document green-permit"><h3>许　可　证</h3><div class="permit-number">第 <b>${scenario.documentFields.find(([key])=>key==='number')?.[2]||'—'}</b> 号</div><p>${scenario.documentText}</p><div class="permit-footer"><span class="station-seal">株洲站<br>行车专用章</span><span>株洲站（站名印）　车站值班员（签名）<br>课堂训练当日填发</span></div></section>`;
  }
  if(scenario.documentType==='route-ticket'){
    return `<section class="credential-document route-ticket"><div class="rail-mark">Ω</div><h3>路　票 <small>（下　行）</small></h3><div class="route-record">电话记录第 <b>${scenario.phoneRecordNumber}</b> 号</div><div class="route-direction"><b>株洲</b><i>→</i><b>七斗冲</b></div><p>准许第 <b>2026</b> 次列车由株洲站1道向七斗冲方向发车。</p><div class="ticket-footer"><span class="station-seal">株洲站<br>行车专用章</span><span>株洲站（站名印）</span><b>编号 ${scenario.ticketSerial}</b></div></section>`;
  }
  const fields=(scenario.documentFields||[]).map(([,label,value])=>`<li><span>${label}</span><b>${value}</b></li>`).join('');
  return `<section class="credential-document"><h3>${scenario.documentTitle}</h3><p>${scenario.documentText}</p>${fields?`<ol>${fields}</ol>`:''}</section>`;
}
function renderCredentialModal(state){
  if(!credentialRoot)return;const box=credentialRoot.querySelector('.credential-body');const scenario=getScenario(state.scenarioId);
  if(!state.scenarioSelected){box.innerHTML='<p class="credential-empty">请先在右侧选择一个训练场景。</p>';return;}
  let content=`<p class="credential-context"><b>${scenario.label}</b>：${scenario.description}</p>`;
  if(scenario.id==='normal'){
    if(!state.radioContacted) content+=`${credentialAction('播放车站联控录音并完成文字应答','normal-contact','normal')}<p class="credential-note">录音内容对应“2026次、七斗冲方向、株洲站1道出站信号好了”。</p>`;
    else if(!state.signalMeaningCorrect) content+='<p class="credential-note ok">车站联控录音已播放。请关闭此页，点击窗外出站信号机确认绿灯；随后返回本页确认运行方向。</p>';
    else if(!state.directionObserved||(state.trainingMode==='teaching'&&!state.directionCorrect)) content+=`<div class="credential-choice"><b>确认运行方向</b>${credentialAction('七斗冲方向','normal-direction-correct')}${credentialAction('其他方向','normal-direction-wrong')}</div>`;
    else content+='<p class="credential-note ok">出站信号和运行方向已确认。请关闭本页，观察左上角发车手信号视频并点击确认。</p>';
  } else if(scenario.id==='weather') {
    if(!state.orderSigned) content+=`${credentialDocument(scenario)}${credentialAction('签收并确认调度命令','weather-order')}`;
    else if(!state.locomotiveSignalObserved) content+=`<div class="credential-choice"><b>确认机车信号显示</b>${credentialAction('绿灯','weather-loco-green')}${credentialAction('黄灯','weather-loco-wrong')}</div>`;
    else if(!state.weatherReportSent) content+=`${credentialAction('报告：地面出站信号无法辨认；接收发车通知','weather-report','departure')}<p class="credential-note">完成后按机车信号低速起动，接近地面出站信号机时必须再次确认。</p>`;
    else content+=`<p class="credential-note ok">开车通知已收到。${state.handSignalConfirmed?(state.credentialStage==='confirm-ground-signal'?'请点击窗外地面出站信号机确认。':'按机车信号低速起动。'):'请关闭本页，观察左上角发车手信号视频并点击确认。'}</p>`;
  } else {
    if(scenario.id==='routeTicket'&&!state.orderSigned) content+=`${credentialDocument(scenario,'order')}${credentialAction('签收并确认调度命令','route-order')}`;
    else if(scenario.id==='greenPermit'&&!state.radioContacted) content+=`${credentialAction('播放绿色许可证联控录音并完成文字应答','permit-contact','greenPermit')}`;
    else if(!state.credentialPresented) content+=`${credentialAction(`显示并核对${scenario.documentTitle}`,'credential-open')}`;
    else if(!state.credentialAttempted) content+=`${credentialDocument(scenario)}<div class="credential-choice"><b>核对结果</b>${credentialAction('信息一致，确认凭证','credential-correct')}${credentialAction('信息不一致','credential-wrong')}</div>`;
    else if(state.lkjUnlockRequired&&!state.lkjUnlockCorrect&&!(state.trainingMode==='assessment'&&state.lkjUnlockAttempted)) {
      const values=(scenario.lkjUnlockFields||[]).map(([,label,value])=>`${label} ${value}`).join('、');
      const unlockInstruction=state.trainingMode==='teaching'?`在监控主界面长按【↑】2秒，选择“${scenario.lkjUnlockLabel}”，输入${values}，再按【解锁】＋【确认】。`:'在监控主界面长按【↑】2秒，按凭证内容选择方式、输入号码并完成【解锁】＋【确认】。';
      content+=`${credentialDocument(scenario)}<p class="credential-note">当前凭证要求完成LKJ非正常行车确认：${unlockInstruction}</p>${credentialAction('打开LKJ完成非正常行车确认','open-lkj-unlock')}`;
    }
    else if(!state.departureNoticeReceived) content+=`${credentialDocument(scenario)}${credentialAction('播放发车通知并完成文字应答','departure-notice','departure')}`;
    else content+=state.handSignalConfirmed?'<p class="credential-note ok">行车凭证、发车通知和发车手信号均已确认，可以按驾驶台流程发车。</p>':'<p class="credential-note ok">行车凭证和发车通知已确认。请关闭本页，观察左上角发车手信号视频并点击确认。</p>';
  }
  box.innerHTML=content;
  box.querySelectorAll('[data-credential-action]').forEach((button)=>button.addEventListener('click',()=>{
    const action=button.dataset.credentialAction;let accepted=false;
    if(action==='normal-contact'){accepted=command('station-contact');}
    else if(action==='normal-direction-correct'){accepted=command('direction-answer','qidouchong');}
    else if(action==='normal-direction-wrong'){accepted=command('direction-answer','other');}
    else if(action==='weather-order'){accepted=command('order-sign');}
    else if(action==='weather-loco-green'){accepted=command('locomotive-signal-answer','green');}
    else if(action==='weather-loco-wrong'){accepted=command('locomotive-signal-answer','yellow');}
    else if(action==='weather-report'){accepted=command('weather-report');}
    else if(action==='route-order'){accepted=command('order-sign');}
    else if(action==='permit-contact'){accepted=command('station-contact');}
    else if(action==='credential-open'){accepted=command('credential-open');}
    else if(action==='credential-correct'){accepted=command('credential-submit',true);}
    else if(action==='credential-wrong'){accepted=command('credential-submit',false);}
    else if(action==='open-lkj-unlock'){openLkj('special-unlock');return;}
    else if(action==='departure-notice'){accepted=command('departure-notice');}
    if(accepted&&button.dataset.audioKind)playStationAudio(button.dataset.audioKind);
    renderCredentialModal(sim.state);
  }));
}
function buildTrainingControls(){
  const root=$('#training-controls');if(!root)return;
  root.innerHTML=`<div class="training-row mode-row"><button type="button" data-mode="teaching">教学模式</button><button type="button" data-mode="assessment">考评模式</button></div><div class="training-row scenario-row">${Object.values(SCENARIOS).map((scenario)=>`<button type="button" data-scenario="${scenario.id}">${scenario.shortLabel}</button>`).join('')}</div><button type="button" class="credential-entry" data-credential-entry>进入凭证确认台</button><p class="initial-check-state" data-initial-state>请在驾驶台逐项核对初始位置。</p><div class="initial-check-grid" data-initial-grid>${INITIAL_CHECKS.map(([key,label,target])=>`<button type="button" class="initial-check-card pending" data-initial-card="${key}"><b>${label}</b><span>${target} · 未核对</span></button>`).join('')}</div><div class="training-row"><button type="button" data-training="initial">提交初始位置核对</button></div><p class="training-state" data-training-state></p>`;
  root.querySelector('[data-training="initial"]').addEventListener('click',()=>command('initial-confirm'));
  root.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>command('training-mode',b.dataset.mode)));
  root.querySelectorAll('[data-scenario]').forEach(b=>b.addEventListener('click',()=>command('scenario-select',b.dataset.scenario)));
  root.querySelectorAll('[data-initial-card]').forEach((card)=>card.addEventListener('click',()=>focusInitialCheck(card.dataset.initialCard)));
  root.querySelector('[data-credential-entry]').addEventListener('click',openCredentialModal);
  syncTrainingControls(sim.state);
}
function focusInitialCheck(key){
  const item=INITIAL_CHECKS.find(([id])=>id===key);if(!item)return;
  const [,,target]=item;
  const direct={traction:elements.tractionPosition,direction:elements.directionPosition,autoBrake:elements.autoPosition,independentBrake:elements.independentPosition,parkingBrake:elements.parkingApply};
  if(direct[key]){direct[key].focus?.();direct[key].animate?.([{outlineColor:'#75e9ff'},{outlineColor:'#75e9ff'},{outlineColor:'transparent'}],{duration:900});}
  else if(['panto','mainBreaker','compressor'].includes(key)){openSwitchPanel();}
  $('#hint').textContent=`请在驾驶台核对“${item[1]}”是否处于${target}，核对正确后该方框会变绿。`;
}
function syncTrainingControls(state){
  const root=$('#training-controls');if(!root)return;const initialButton=root.querySelector('[data-training="initial"]');initialButton.classList.toggle('active',state.initialConfirmed);
  const checked=INITIAL_CHECKS.filter(([key])=>state.initialChecks?.[key]).length;initialButton.disabled=state.trainingMode==='teaching'&&!state.initialConfirmed&&checked<INITIAL_CHECKS.length;root.querySelector('[data-initial-state]').textContent=state.initialConfirmed?'8项设备初始位置均已完成核对。':state.trainingMode==='assessment'&&state.initialAttempted?`初始位置核对已提交：已核对 ${checked}/${INITIAL_CHECKS.length}，结果将在本次成绩中显示。`:`初始位置已核对 ${checked}/${INITIAL_CHECKS.length}：点击方框可定位设备，实际在驾驶台完成核对。`;
  for(const [key,label,target] of INITIAL_CHECKS){const card=root.querySelector(`[data-initial-card="${key}"]`);if(!card)continue;const checkedNow=Boolean(state.initialChecks?.[key]);const correct=sim.initialCheckIsCorrect(key);card.classList.remove('pending','current','done','warning');if(checkedNow&&correct){card.classList.add('done');card.querySelector('span').textContent=`${target} · 已核对`;}else if(state.trainingMode==='teaching'&&!correct){card.classList.add('warning');card.querySelector('span').textContent=`${target} · 请调整`;}else if(checked===INITIAL_CHECKS.length&&state.trainingMode==='teaching'){card.classList.add('current');card.querySelector('span').textContent=`${target} · 待复核`;}else{card.classList.add('pending');card.querySelector('span').textContent=state.trainingMode==='assessment'&&checkedNow?`${target} · 已操作`:`${target} · 未核对`;}}
  root.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===state.trainingMode));
  root.querySelectorAll('[data-scenario]').forEach(b=>b.classList.toggle('active',b.dataset.scenario===state.scenarioId&&state.scenarioSelected));
  root.querySelector('[data-credential-entry]').disabled=!state.scenarioSelected;
  const scenario=getScenario(state.scenarioId);root.querySelector('[data-training-state]').textContent=`当前：${state.trainingMode==='teaching'?'教学':'考评'}模式 · ${state.scenarioSelected?scenario.label:'未选择场景'}${state.authority?' · 行车凭证已确认':''}`;
}
function buildResultReport(){
  const root=document.createElement('div');root.className='device-modal result-modal';root.setAttribute('aria-hidden','true');
  root.innerHTML=`<div class="device-shell result-shell" role="dialog" aria-modal="true" aria-label="发车作业考评成绩单"><div class="device-head"><div><strong>发车作业考评成绩单</strong><span>课堂训练结果，不作为实际作业记录</span></div><button type="button" class="device-close" aria-label="关闭成绩单">×</button></div><div class="result-body"><div class="result-score"><b data-result-score>0</b><span>分</span></div><p data-result-summary></p><ol data-result-items></ol><button type="button" class="result-close">完成查看</button></div></div>`;
  const close=()=>{root.classList.remove('open');root.setAttribute('aria-hidden','true');document.body.classList.remove('device-panel-active');};root.querySelector('.device-close').addEventListener('click',close);root.querySelector('.result-close').addEventListener('click',close);root.addEventListener('click',(event)=>{if(event.target===root)close();});document.body.append(root);resultRoot=root;
}
function showResultReport(state){
  if(state.trainingMode!=='assessment'||resultShown)return;if(!resultRoot)buildResultReport();const score=scoreRun(state);const p=procedureState(state);
  resultRoot.querySelector('[data-result-score]').textContent=score.score;resultRoot.querySelector('[data-result-summary]').textContent=`完成 ${score.completed}/${PROCEDURE.length} 个作业项点${score.deductions?`，操作扣分 ${score.deductions} 分`:'，无操作扣分'}。`;
  resultRoot.querySelector('[data-result-items]').innerHTML=score.itemScores.map((item)=>`<li class="${item.correct?'pass':'fail'}"><span>${item.label}${item.locked?'（动车时未完成，已锁定失分）':item.earned>0&&!item.correct?'（部分完成）':item.complete&&!item.correct?'（操作或核对错误）':''}</span><b>${item.earned}/${item.weight}</b></li>`).join('');resultRoot.classList.add('open');resultRoot.setAttribute('aria-hidden','false');document.body.classList.add('device-panel-active');resultShown=true;
}
function closeDevicePanels(){closeSwitchPanel();closePowerCabinet();closeLkj();closeSignalInspection();closeCredentialModal();if(hornPointerId!==null)stopHorn();else{hornAudio.pause();hornAudio.currentTime=0;if(sim.state.hornActive)command('horn-stop');}}
function buildSwitchPanel(){
  const root=document.createElement('div');root.id='switch-panel-modal';root.className='switch-panel-modal';root.setAttribute('aria-hidden','true');
  root.innerHTML=`<div class="switch-panel-shell" role="dialog" aria-modal="true" aria-label="HXD1C板钮面板"><div class="switch-panel-head"><div><strong>板钮面板</strong><span>点击上半区或下半区拨动，板钮保持在所选位置</span></div><button type="button" class="switch-panel-close" aria-label="关闭板钮面板">×</button></div><div class="switch-panel-photo"><img src="./assets/switch-panel/HXD1C-switch-panel-reference.jpg" alt="HXD1C板钮面板实物参考" /><div class="switch-panel-controls"></div></div><div class="switch-panel-status">主断：上合/下分；受电弓：上升/下降；空压机：上投入/下停止。</div></div>`;
  const controls=root.querySelector('.switch-panel-controls');
  for(const def of switchDefs){
    const button=document.createElement('button');button.type='button';button.className=`switch-unit type-${def.type}`;button.dataset.switchId=def.id;button.style.setProperty('--switch-x',def.x);button.setAttribute('aria-label',def.label);
    button.innerHTML=`<span class="switch-mask"><span class="switch-slot"></span><span class="switch-lever"><i></i></span></span><span class="switch-name">${def.label}</span><span class="switch-value">0</span>`;
    button.addEventListener('click',(event)=>operateSwitch(def,button,event));controls.append(button);
  }
  root.querySelector('.switch-panel-close').addEventListener('click',closeSwitchPanel);
  root.addEventListener('click',(event)=>{if(event.target===root)closeSwitchPanel();});
  document.body.append(root);switchPanelRoot=root;syncSwitchPanel(sim.state);
}
function setSwitchPanelMessage(message=''){
  if(!switchPanelRoot)return;const status=switchPanelRoot.querySelector('.switch-panel-status');if(!status)return;
  const normal='主断：上合/下分；受电弓：上升/下降；空压机：上投入/下停止。';
  status.textContent=message||normal;status.classList.toggle('message',Boolean(message));clearTimeout(switchPanelMessageTimer);if(message)switchPanelMessageTimer=setTimeout(()=>{status.textContent=normal;status.classList.remove('message');},2600);
}
function openSwitchPanel(){if(selectedView!=='front')return;if(!switchPanelRoot)buildSwitchPanel();switchPanelRoot.classList.add('open');switchPanelRoot.setAttribute('aria-hidden','false');document.body.classList.add('switch-panel-active');syncSwitchPanel(sim.state);}
function closeSwitchPanel(){if(!switchPanelRoot)return;switchPanelRoot.classList.remove('open');switchPanelRoot.setAttribute('aria-hidden','true');document.body.classList.remove('switch-panel-active');}
function operateSwitch(def,button,event){
  const state=sim.state;const rect=button.getBoundingClientRect();const ratio=rect.height?((event?.clientY||rect.top+rect.height/2)-rect.top)/rect.height:.5;
  if(def.initialCheck&&!state.lkjConfirmed&&ratio>=.35&&ratio<=.65){command('initial-inspect',def.initialCheck);syncSwitchPanel(sim.state);return;}
  let targetUp=true;let accepted=true;
  if(def.states){const current=def.read(state);const next=def.states[(def.states.indexOf(current)+1)%def.states.length];targetUp=next==='white';accepted=command(def.id,next);}
  else if(def.directional){targetUp=event?.clientY?event.clientY<rect.top+rect.height/2:!Boolean(def.read(state));accepted=command(def.id,targetUp);}
  else{targetUp=!Boolean(def.read(state));accepted=command(def.id,targetUp);}
  button.classList.remove('throw-up','throw-down','rejected');void button.offsetWidth;button.classList.add(targetUp?'throw-up':'throw-down');
  if(accepted===false)button.classList.add('rejected');
  setTimeout(()=>button.classList.remove('throw-up','throw-down','rejected'),260);syncSwitchPanel(sim.state);
  navigator.vibrate?.(accepted===false?[30,35,30]:18);
}
function syncSwitchPanel(state){
  if(!switchPanelRoot)return;
  for(const def of switchDefs){const button=switchPanelRoot.querySelector(`[data-switch-id="${def.id}"]`);if(!button)continue;const value=def.read(state);button.classList.remove('state-up','state-mid','state-down');let label='0';if(def.states){label=value==='white'?'白':value==='red'?'红':'0';button.classList.add(value==='white'?'state-up':value==='red'?'state-down':'state-mid');}else{const on=Boolean(value);label=on?def.on:def.off;button.classList.add(on?'state-up':'state-down');}button.querySelector('.switch-value').textContent=label;button.setAttribute('aria-pressed',String(Boolean(value&&value!=='0')));}
}
function bindDrag() { addEventListener('pointermove',(event)=>{ if(!activeDrag||(activeDrag.pointerId!==undefined&&event.pointerId!==activeDrag.pointerId))return; event.preventDefault(); const d=activeDrag; const delta=Math.round((d.startY-event.clientY)/d.pixelsPerStep); if(d.id==='traction')command('traction',Math.max(-8,Math.min(7,d.start+delta))); else command(d.id==='auto'?'auto-brake':'independent-brake',Math.max(0,Math.min(5,d.start+delta))); },{passive:false}); addEventListener('pointerup',(event)=>{if(!activeDrag||activeDrag.pointerId===event.pointerId)activeDrag=null}); addEventListener('pointercancel',(event)=>{if(!activeDrag||activeDrag.pointerId===event.pointerId)activeDrag=null}); }
function activeState(id,state) { return Boolean(state[id==='panto'?'panto':id==='main-breaker'?'mainBreaker':id==='control-power'?'powerOn':id==='parking'?'parkingBrake':id==='headlight'?'headlight':id==='compressor'?'compressor':id==='authority'?'authority':id==='horn'?'hornActive':id==='lkj'?'lkjAttempted':id==='reset'?'vigilanceAcknowledged':false]); }
function syncSignalTarget(state){
  if(!signalTarget)return;
  const point=routeScene.getDepartureSignalScreenPosition();
  // 观察按钮只允许锚定真实本线出站信号机，不能回退到站台上的固定坐标。
  const visible=selectedView==='front'&&state.distance<=ROUTE_CONTEXT.departureSignalDistance+35&&Boolean(point?.visible);
  signalTarget.classList.toggle('visible',Boolean(visible));
  if(!visible)return;
  // 透明热区直接覆盖本线实体信号机，不再显示悬浮文字、圆点或引导线。
  signalTarget.style.left=`${point.x}%`;signalTarget.style.top=`${point.y}%`;
}
function syncHandSignalCard(state){
  if(!handSignalCard)return;
  const shouldOpen=selectedView==='front'&&state.handSignalRequired&&state.credentialConfirmed&&(state.credentialCorrect||state.trainingMode==='assessment')&&!state.handSignalConfirmed;
  const wasOpen=handSignalCard.classList.contains('open');
  handSignalCard.classList.toggle('open',shouldOpen);
  if(shouldOpen===wasOpen)return;
  const video=handSignalCard.querySelector('video');
  if(shouldOpen){video.currentTime=0;video.play().catch(()=>{});}else video.pause();
}
function render(state,message='') {
  routeScene.setTrainingScenario(state.scenarioId);
  routeScene.setDepartureSignalAspect(state.signalAspect);
  // 线路及地面实体信号机从进入驾驶台起就可见；不得再依赖 LKJ 答对后才显示。
  routeScene.update(state.distance,state.speed,selectedView,true);
  syncSignalTarget(state);
  syncHandSignalCard(state);
  if(selectedView==='front') {
    frame(elements.auto,[0,1,2,9,10,11][state.autoBrake],4,3); frame(elements.independent,Math.min(11,state.independentBrake),4,3); frame(elements.traction,tractionFrame(state.traction),2,8); frame(elements.direction,state.direction==='R'?0:state.direction==='N'?1:2,3,1);
    for(const [id] of keys) elements[id]?.classList.toggle('on',activeState(id,state));
    // 严格按原 HXD1C.cvf 的 DIAL ScaleRange 映射；不能为了夸大变化
    // 临时缩小量程，否则同一压力会落在错误刻度。
    setNeedle(elements.speedNeedle,state.speed,158); setNeedle(elements.mainNeedle,state.mainRes,1600); setNeedle(elements.pipeNeedle,state.trainPipe,1000); setNeedle(elements.eqNeedle,state.equalizingRes,1600); setNeedle(elements.cylNeedle,state.brakeCyl,1600); setNeedle(elements.mainNeedle2,state.mainRes,1600); setNeedle(elements.pipeNeedle2,state.trainPipe,1600); setNeedle(elements.eqNeedle2,state.equalizingRes,1600); setNeedle(elements.cylNeedle2,state.brakeCyl,1600);
    const current=Math.max(0,state.traction)*105; elements.voltageBar.style.transform=`scaleY(${Math.max(.03,state.netVoltage/30)})`; elements.currentBars.forEach((bar,index)=>bar.style.transform=`scaleY(${Math.max(.02,Math.min(1,(current-index*22)/1000))})`);
    const scenario=getScenario(state.scenarioId);const activeLimit=state.lkjUnlockCorrect&&state.lkjUnlockLimit?state.lkjUnlockLimit:state.limitedStart?15:scenario.requiresLkjUnlock?20:30;
    elements.speedDigital.textContent=state.speed<10?state.speed.toFixed(1):Math.round(state.speed); elements.limitDigital.textContent=String(activeLimit); elements.clockDigital.textContent=new Date().toLocaleTimeString('zh-CN',{hour12:false});
    const autoNames=['运转位','初制动位','常用制动Ⅱ','常用制动Ⅲ','常用制动Ⅳ','紧急位'];const independentNames=['缓解位','制动Ⅰ','制动Ⅱ','制动Ⅲ','制动Ⅳ','全制动位'];
    elements.autoPosition.querySelector('span').textContent=autoNames[state.autoBrake];elements.independentPosition.querySelector('span').textContent=independentNames[state.independentBrake];elements.directionPosition.querySelector('span').textContent=state.direction==='F'?'前进位':state.direction==='R'?'后退位':'中立位';elements.tractionPosition.querySelector('span').textContent=state.traction>0?`牵引 ${state.traction} 级`:state.traction<0?`电制动 ${Math.abs(state.traction)} 级`:'零位';
    frame(elements.pantoDisplay,state.panto?1:0,1,2); frame(elements.signal,SIGNAL_ASPECTS[state.signalAspect].frame,4,2);
  }
  for(const [id] of keys) document.querySelector(`#keys [data-id="${id}"]`)?.classList.toggle('active',activeState(id,state));
  syncSwitchPanel(state);
  if(message&&switchPanelRoot?.classList.contains('open'))setSwitchPanelMessage(message);
  syncPowerCabinet(state);
  renderSignalInspection(state);renderCredentialModal(state);syncTrainingControls(state);
  const assessmentFinished=state.trainingMode==='assessment'&&state.completed;if(!assessmentFinished)resultShown=false;
  const p=procedureState(state); $('#procedure').innerHTML=PROCEDURE.map(([n],i)=>`<li class="${p.complete[i]?'done':i===p.current?'active':''}">${n}</li>`).join(''); const score=scoreRun(state); const aspect=SIGNAL_ASPECTS[state.signalAspect];const scenario=getScenario(state.scenarioId); $('#status').innerHTML=`<strong>状态：</strong>${state.completed?'训练完成':'第 '+(p.current+1)+' 步'}<br>场景 ${state.scenarioSelected?scenario.label:'未选择场景'} · 凭证 ${state.scenarioSelected?scenario.credential:'—'}<br>总风 ${state.mainRes.toFixed(0)} kPa · 制动缸 ${state.brakeCyl.toFixed(0)} kPa<br>地面信号 ${aspect.label}${state.authority?' · 行车凭证已确认':''}<br>LKJ ${state.lkjStartCorrect?'已开车对标':state.lkjStartAttempted?'开车对标待复核':'开车对标待执行'}<br>速度 ${state.speed.toFixed(1)} km/h · ${state.lowNotchStartConfirmed?'低级位起动已确认':'低级位起动中'} · 当前得分 ${score.score}${score.deductions?` · 扣分 ${score.deductions}`:''}`; const workflowProgress=$('[data-workflow-progress]');if(workflowProgress)workflowProgress.textContent=`${p.complete.filter(Boolean).length}/${PROCEDURE.length}`; if(message)$('#hint').textContent=message;if(p.done||assessmentFinished)showResultReport(state);
}
function stopHorn(event){if(hornPointerId===null)return;if(event?.pointerId!==undefined&&event.pointerId!==hornPointerId)return;hornPointerId=null;hornAudio.pause();hornAudio.currentTime=0;if(sim.state.hornActive)command('horn-stop');elements.hornButton?.classList.remove('pressed');}
function buildKeys(){if(!debugMode)return;document.body.classList.add('debug-mode');const root=$('#keys');keys.forEach(([id,name])=>{const b=document.createElement('button');b.dataset.id=id;b.textContent=name;b.addEventListener('click',()=>command(id));root.append(b);});}
function setView(view){closeDevicePanels();selectedView=view;const cab=$('#cab');cab.src=`./assets/archive-cabview/${views[view]}`;cab.classList.toggle('side-view',view!=='front');routeScene.setView(view);document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));if(view==='front')createFront();else overlay.replaceChildren();render(sim.state);}
function setControlDrawer(targetId=null){
  const drawers=['workflow','training'];
  for(const id of drawers){
    const open=id===targetId;
    $(`#${id}-drawer`)?.classList.toggle('open',open);
    $(`#${id}-toggle`)?.setAttribute('aria-expanded',String(open));
  }
  const anyOpen=drawers.includes(targetId);
  $('#workflow-scrim')?.classList.toggle('open',anyOpen);
  document.body.classList.toggle('control-drawer-open',anyOpen);
}
function bindControlDrawers(){
  for(const id of ['workflow','training']){
    $(`#${id}-toggle`)?.addEventListener('click',()=>setControlDrawer($(`#${id}-drawer`)?.classList.contains('open')?null:id));
    $(`#${id}-close`)?.addEventListener('click',()=>setControlDrawer());
  }
  $('#workflow-scrim')?.addEventListener('click',()=>setControlDrawer());
  addEventListener('keydown',(event)=>{if(event.key==='Escape')setControlDrawer();});
}
const mobileLike=matchMedia('(pointer: coarse)').matches||matchMedia('(max-height:600px) and (orientation:landscape)').matches||navigator.maxTouchPoints>0||/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
if(mobileLike)document.body.classList.add('mobile-controls-enabled');
async function enterImmersive(){
  document.documentElement.classList.add('immersive');
  $('#landscape-gate').hidden=true;
  try{const root=document.documentElement;if(root.requestFullscreen)await root.requestFullscreen({navigationUI:'hide'});else if(root.webkitRequestFullscreen)await root.webkitRequestFullscreen();}catch{ /* iPhone Safari 常拒绝普通网页全屏，CSS 沉浸模式继续生效。 */ }
  try{await screen.orientation?.lock?.('landscape');}catch{ /* iOS 及部分浏览器不允许网页锁定方向。 */ }
  setTimeout(()=>{scrollTo(0,1);routeScene.resize();},120);
}
async function exitImmersive(){
  closeDevicePanels();
  try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.webkitFullscreenElement)await document.webkitExitFullscreen();}catch{ /* CSS 状态仍可正常退出。 */ }
  document.documentElement.classList.remove('immersive');
  routeScene.resize();
}
$('#enter-training').addEventListener('click',enterImmersive);
$('#exit-immersive').addEventListener('click',exitImmersive);
addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&document.documentElement.classList.contains('immersive')&&!mobileLike)document.documentElement.classList.remove('immersive');routeScene.resize();});
addEventListener('orientationchange',()=>{closeDevicePanels();setTimeout(()=>routeScene.resize(),160);});
window.visualViewport?.addEventListener('resize',()=>routeScene.resize());
addEventListener('pointerup',stopHorn,true);addEventListener('pointercancel',stopHorn,true);addEventListener('blur',()=>stopHorn());addEventListener('pagehide',()=>stopHorn());document.addEventListener('visibilitychange',()=>{if(document.hidden)stopHorn();});
$('#stage').addEventListener('click',(event)=>{if(selectedView!=='front'||document.body.classList.contains('device-panel-active')||document.body.classList.contains('switch-panel-active'))return;if(routeScene.hitTestDepartureSignal(event.clientX,event.clientY))openSignalInspection();});
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));buildSwitchPanel();buildLkj();buildTrainingControls();buildKeys();bindDrag();bindControlDrawers();setView('front');sim.onChange(render);let last=performance.now();function loop(now){sim.tick(Math.min(.05,(now-last)/1000));routeScene.render();last=now;requestAnimationFrame(loop)}requestAnimationFrame(loop);
