import { writeFile } from 'node:fs/promises';

const port = Number(process.env.CDP_PORT || 9224);
const baseUrl = process.env.TRAINING_URL || 'http://127.0.0.1:4174/?debug=1';
const screenshotPath = process.env.SCREENSHOT_PATH || `${process.env.TEMP || '.'}/credential-browser-smoke.png`;
const viewportWidth = Number(process.env.VIEWPORT_WIDTH || 1600);
const viewportHeight = Number(process.env.VIEWPORT_HEIGHT || 1200);
const mobile = process.env.MOBILE === '1';
const drawer = process.env.DRAWER || 'training';
const captureDevice = process.env.CAPTURE_DEVICE || '';

const pages = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
const page = pages.find((entry) => entry.type === 'page');
if (!page) throw new Error('没有可用的浏览器页面。');

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let nextId = 0;
const pending = new Map();
const consoleErrors = [];
const networkErrors = [];
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
    return;
  }
  if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    consoleErrors.push(message.params.args.map((arg) => arg.value || arg.description || '').join(' '));
  }
  if (message.method === 'Network.loadingFailed' && !message.params.canceled && message.params.errorText !== 'net::ERR_ABORTED') {
    networkErrors.push(message.params.errorText);
  }
});

function send(method, params = {}) {
  const id = ++nextId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression, awaitPromise = false) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

await Promise.all([send('Page.enable'), send('Runtime.enable'), send('Network.enable')]);
await send('Emulation.setDeviceMetricsOverride', {
  width: viewportWidth, height: viewportHeight, deviceScaleFactor: 1, mobile,
  screenWidth: viewportWidth, screenHeight: viewportHeight,
});
await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
await send('Page.navigate', { url: baseUrl });
await evaluate(`new Promise((resolve, reject) => {
  const started = Date.now();
  const timer = setInterval(() => {
    const ready = document.querySelector('.route-scene.live') && document.querySelectorAll('#procedure li').length === 13;
    if (ready) { clearInterval(timer); resolve(true); }
    else if (Date.now() - started > 30000) { clearInterval(timer); reject(new Error('页面初始化超时')); }
  }, 100);
})`, true);

await evaluate(`document.querySelector('[data-scenario="normal"]').click(); true`);
await new Promise((resolve) => setTimeout(resolve, 400));
const signalStates = {};
for (const scenario of ['normal', 'weather', 'greenPermit', 'routeTicket']) {
  signalStates[scenario] = await evaluate(`(() => {
    document.querySelector('[data-scenario="${scenario}"]').click();
    const signal = document.querySelector('.signal-trigger');
    return {
      visible: signal.classList.contains('visible'),
      label: signal.textContent,
      left: signal.style.left,
      top: signal.style.top,
      width: getComputedStyle(signal).width,
      background: getComputedStyle(signal).backgroundColor,
    };
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 80));
}
await evaluate(`document.querySelector('[data-scenario="normal"]').click(); true`);
const interactionChecks = await evaluate(`(() => {
  document.querySelector('[data-scenario="routeTicket"]').click();
  document.querySelector('.cir-hotspot').click();
  const dispatchOrderForm = Boolean(document.querySelector('.cir-workflow .credential-document.dispatch-order'));
  document.querySelector('[data-cir-action="order"]').click();
  document.querySelector('.cir-modal .device-close').click();
  document.querySelector('.credential-paper-hotspot').click();
  const routeTicketForm = Boolean(document.querySelector('.credential-document.route-ticket'));
  document.querySelector('.credential-modal .device-close').click();
  document.querySelector('[data-scenario="greenPermit"]').click();
  document.querySelector('.cir-hotspot').click();
  document.querySelector('[data-cir-action="play"]').click();
  document.querySelector('[data-cir-action="contact-correct"]').click();
  document.querySelector('.cir-modal .device-close').click();
  document.querySelector('.credential-paper-hotspot').click();
  const greenPermitForm = Boolean(document.querySelector('.credential-document.green-permit'));
  document.querySelector('.credential-modal .device-close').click();
  document.querySelector('[data-scenario="normal"]').click();
  document.querySelector('#keys [data-id="lkj"]').click();
  document.querySelector('.lkj-trigger').click();
  const firstOpen = document.querySelector('.lkj-screen').innerText.includes('监控主界面');
  document.querySelector('[data-lkj-key="query"]').click();
  const queryReview = document.querySelector('.lkj-screen').innerText.includes('参数核对');
  document.querySelector('.lkj-modal .device-close').click();
  document.querySelector('.lkj-trigger').click();
  const reopenMonitor = document.querySelector('.lkj-screen').innerText.includes('监控主界面');
  document.querySelector('.lkj-modal .device-close').click();
  document.querySelector('.signal-trigger').click();
  const signalClickOpens = document.querySelector('.signal-modal').classList.contains('open');
  document.querySelector('.signal-modal .device-close').click();
  const cirDeviceAvailable = Boolean(document.querySelector('.cir-frame'));
  const locomotiveSignalClickable = Boolean(document.querySelector('.locomotive-signal-hotspot'));
  const cirHotspotRight = parseFloat(document.querySelector('.cir-hotspot')?.style.left || '0') > 90;
  const originalGameNeedles = document.querySelectorAll('img.original-game-needle').length === 9;
  const lkjReferenceScreen = getComputedStyle(document.querySelector('.lkj-screen')).backgroundImage.includes('LKJ2000-monitor-reference.jpg');
  return { dispatchOrderForm, routeTicketForm, greenPermitForm, firstOpen, queryReview, reopenMonitor, signalClickOpens, cirDeviceAvailable, locomotiveSignalClickable, cirHotspotRight, originalGameNeedles, lkjReferenceScreen };
})()`);
const cirTailQuery = await evaluate(`new Promise((resolve) => {
  document.querySelector('[data-scenario="normal"]').click();
  document.querySelector('.cir-hotspot').click();
  const started = Date.now();
  const waitForCir = setInterval(() => {
    const frame = document.querySelector('.cir-frame');
    const win = frame && frame.contentWindow;
    if (!win || !Array.isArray(win.mmiinfo) || typeof win.buttonfix !== 'function' || !win.__credentialCirBridge) {
      if (Date.now() - started > 6000) { clearInterval(waitForCir); resolve(false); }
      return;
    }
    clearInterval(waitForCir);
    win.mmiinfo[1] = '9123456';
    win.mmistate = 1;
    win.buttonfix('bt12');
    setTimeout(() => {
      const text = document.querySelector('.cir-tail-state')?.innerText || '';
      document.querySelector('.cir-modal .device-close')?.click();
      resolve(text.includes('123456') && text.includes('kPa'));
    }, 180);
  }, 100);
})`, true);
interactionChecks.cirTailQuery = cirTailQuery;
const longPressMenu = await evaluate(`new Promise((resolve) => {
  document.querySelector('[data-mode="assessment"]').click();
  document.querySelector('[data-scenario="greenPermit"]').click();
  document.querySelector('#keys [data-id="lkj"]').click();
  document.querySelector('.lkj-trigger').click();
  const up = document.querySelector('[data-lkj-key="up"]');
  up.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
  setTimeout(() => {
    const opened = document.querySelector('.lkj-screen').innerText.includes('非正常行车确认');
    up.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    document.querySelector('.lkj-modal .device-close').click();
    document.querySelector('[data-mode="teaching"]').click();
    document.querySelector('[data-scenario="normal"]').click();
    resolve(opened);
  }, 2150);
})`, true);
interactionChecks.longPressMenu = longPressMenu;
if (mobile) {
  await evaluate(`document.querySelector('#enter-training').click(); true`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  await evaluate(`document.querySelector('#${drawer === 'workflow' ? 'workflow' : 'training'}-toggle').click(); true`);
  await new Promise((resolve) => setTimeout(resolve, 300));
}
if (captureDevice === 'cir') {
  await evaluate(`document.querySelector('.cir-hotspot').click(); true`);
  await new Promise((resolve) => setTimeout(resolve, 500));
} else if (captureDevice === 'lkj') {
  await evaluate(`document.querySelector('#keys [data-id="lkj"]').click(); document.querySelector('.lkj-trigger').click(); true`);
  await new Promise((resolve) => setTimeout(resolve, 250));
}

const summary = await evaluate(`(() => {
  const stage = document.querySelector('#stage').getBoundingClientRect();
  const canvas = document.querySelector('#route-scene');
  const controls = [...document.querySelectorAll('#training-controls button')];
  return {
    title: document.title,
    routeLive: canvas.classList.contains('live'),
    canvasPixels: [canvas.width, canvas.height],
    stagePixels: [Math.round(stage.width), Math.round(stage.height)],
    procedureItems: document.querySelectorAll('#procedure li').length,
    trainingButtons: controls.length,
    scenarioActive: document.querySelector('[data-scenario="normal"]').classList.contains('active'),
    workflowText: document.querySelector('#procedure').innerText,
    trainingText: document.querySelector('#training-controls').innerText,
    hint: document.querySelector('#hint').innerText,
    hasSignalTrigger: Boolean(document.querySelector('.signal-trigger')),
    hasHandSignalVideo: Boolean(document.querySelector('.hand-signal-card video')),
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    mobileControls: document.body.classList.contains('mobile-controls-enabled'),
    immersive: document.documentElement.classList.contains('immersive'),
    trainingDrawerOpen: document.querySelector('#training-drawer').classList.contains('open'),
    workflowDrawerOpen: document.querySelector('#workflow-drawer').classList.contains('open'),
  };
})()`);
summary.signalStates = signalStates;
summary.interactionChecks = interactionChecks;

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
await writeFile(screenshotPath, Buffer.from(shot.data, 'base64'));
socket.close();

console.log(JSON.stringify({ summary, consoleErrors, networkErrors, screenshotPath }, null, 2));
const signalInvalid = Object.values(signalStates).some((state) => !state.visible || state.label.trim() || !state.left || !state.top || state.background !== 'rgba(0, 0, 0, 0)');
const interactionInvalid = Object.values(interactionChecks).some((value) => value !== true);
if (consoleErrors.length || networkErrors.length || signalInvalid || interactionInvalid || summary.overflowX) process.exitCode = 1;
