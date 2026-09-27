import { writeFile } from 'node:fs/promises';

const port = Number(process.env.CDP_PORT || 9224);
const baseUrl = process.env.TRAINING_URL || 'http://127.0.0.1:4174/';
const screenshotPath = process.env.SCREENSHOT_PATH || `${process.env.TEMP || '.'}/credential-browser-smoke.png`;
const viewportWidth = Number(process.env.VIEWPORT_WIDTH || 1600);
const viewportHeight = Number(process.env.VIEWPORT_HEIGHT || 1200);
const mobile = process.env.MOBILE === '1';
const drawer = process.env.DRAWER || 'training';

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
  if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(message.params.exceptionDetails.text);
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
      fogged: signal.classList.contains('fogged'),
      red: signal.classList.contains('aspect-red'),
      label: signal.textContent,
      left: signal.style.left,
      top: signal.style.top,
    };
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 80));
}
await evaluate(`document.querySelector('[data-scenario="normal"]').click(); true`);
if (mobile) {
  await evaluate(`document.querySelector('#enter-training').click(); true`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  await evaluate(`document.querySelector('#${drawer === 'workflow' ? 'workflow' : 'training'}-toggle').click(); true`);
  await new Promise((resolve) => setTimeout(resolve, 300));
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

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
await writeFile(screenshotPath, Buffer.from(shot.data, 'base64'));
socket.close();

console.log(JSON.stringify({ summary, consoleErrors, networkErrors, screenshotPath }, null, 2));
if (consoleErrors.length || networkErrors.length) process.exitCode = 1;
