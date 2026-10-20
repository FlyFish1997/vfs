/**
 * JS Loop Runner - 浏览器扩展
 * 免责声明：本程序仅用于研究学习目的，不保证实际使用效果，请遵循当地法律法规。
 * 交流及版权联系：your-email@example.com
 */

const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const infoInterval = document.getElementById('info-interval');
const infoStop = document.getElementById('info-stop');
const infoRefresh = document.getElementById('info-refresh');
const infoCount = document.getElementById('info-count');
const resultArea = document.getElementById('result-area');
const resultValue = document.getElementById('result-value');

let currentTabId = null;
let running = false;

// 载入配置
async function loadConfig() {
  const defaults = { code: '', interval: 1000, stopReturn: '', refreshReturn: '' };
  let result;
  try {
    result = await chrome.storage.sync.get(defaults);
  } catch {
    result = await chrome.storage.local.get(defaults);
  }
  return {
    code: result.code || defaults.code,
    interval: result.interval || defaults.interval,
    stopReturn: result.stopReturn ?? defaults.stopReturn,
    refreshReturn: result.refreshReturn ?? defaults.refreshReturn
  };
}

// 刷新 UI
function renderUI(config, isRunning, count, lastResult, isReloading) {
  infoInterval.textContent = (config ? config.interval : '') + 'ms';
  infoStop.textContent = (config && config.stopReturn) || '（未设置）';
  infoRefresh.textContent = (config && config.refreshReturn) || '（未设置）';
  infoCount.textContent = count || 0;

  running = isRunning;
  if (isReloading) {
    statusDot.className = 'dot running';
    statusText.textContent = '刷新中...';
    btnStart.disabled = true;
    btnStop.disabled = true;
  } else if (isRunning) {
    statusDot.className = 'dot running';
    const hasRefresh = config && config.refreshReturn;
    statusText.textContent = hasRefresh ? '运行中（含刷新）' : '运行中';
    btnStart.disabled = true;
    btnStop.disabled = false;
  } else {
    statusDot.className = 'dot stopped';
    statusText.textContent = '已停止';
    btnStart.disabled = false;
    btnStop.disabled = true;
  }

  if (lastResult !== undefined && lastResult !== null) {
    resultArea.hidden = false;
    resultValue.textContent = String(lastResult);
  } else {
    resultArea.hidden = true;
  }
}

// 从 content script 查询状态
async function queryState(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'GET_STATE' });
    return response;
  } catch {
    return { running: false, count: 0, lastResult: null };
  }
}

// 主入口
document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    statusText.textContent = '无法获取当前标签页';
    btnStart.disabled = true;
    return;
  }
  currentTabId = tab.id;

  const config = await loadConfig();
  const state = await queryState(currentTabId);

  renderUI(config, state.running, state.count, state.lastResult);

  // 如果正在运行，持续刷新
  if (state.running) {
    pollState();
  }
});

// 定时轮询状态
let pollTimer = null;
function pollState() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    if (!running) {
      clearInterval(pollTimer);
      pollTimer = null;
      return;
    }
    const state = await queryState(currentTabId);
    infoCount.textContent = state.count || 0;
    if (state.lastResult !== undefined && state.lastResult !== null) {
      resultArea.hidden = false;
      resultValue.textContent = String(state.lastResult);
    }
    if (!state.running) {
      running = false;
      renderUI(null, false, state.count, state.lastResult);
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }, 500);
}

// 向 content script 发送启动消息
async function sendStart(tabId, cfg) {
  await chrome.tabs.sendMessage(tabId, { type: 'START', config: cfg, tabId });
}

// 启动（带自动注入回退）
btnStart.addEventListener('click', async () => {
  const config = await loadConfig();
  if (!config.code.trim()) {
    statusText.textContent = '请先在选项页配置 JS 代码';
    return;
  }

  const startConfig = {
    code: config.code,
    interval: config.interval,
    stopReturn: config.stopReturn,
    refreshReturn: config.refreshReturn
  };

  try {
    await sendStart(currentTabId, startConfig);
    renderUI(config, true, 0, null);
    pollState();
  } catch {
    // content script 未加载（例如刚安装扩展），尝试程序化注入
    statusText.textContent = '正在注入...';
    try {
      await chrome.scripting.executeScript({
        target: { tabId: currentTabId },
        files: ['content.js']
      });
      await new Promise(r => setTimeout(r, 200));
      await sendStart(currentTabId, startConfig);
      renderUI(config, true, 0, null);
      pollState();
    } catch {
      statusText.textContent = '启动失败，请刷新页面后重试';
    }
  }
});

// 停止
btnStop.addEventListener('click', async () => {
  try {
    await chrome.tabs.sendMessage(currentTabId, { type: 'STOP' });
    // 通知 background 清除可能的待重启状态
    chrome.runtime.sendMessage({ type: 'CLEAR_PENDING', tabId: currentTabId }).catch(() => {});
    const state = await queryState(currentTabId);
    renderUI(null, false, state.count, state.lastResult);
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  } catch (err) {
    statusText.textContent = '停止失败: ' + err.message;
  }
});

// 监听来自 content script 的状态更新
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'STATE_UPDATE') {
    infoCount.textContent = msg.count || 0;
    if (msg.lastResult !== undefined && msg.lastResult !== null) {
      resultArea.hidden = false;
      resultValue.textContent = String(msg.lastResult);
    }
  }
  if (msg.type === 'LOOP_STOPPED') {
    if (msg.reason === 'reloading') {
      // 刷新模式：保持运行状态，显示"刷新中"
      running = true;
      renderUI(null, true, msg.count, msg.lastResult, true);
    } else {
      running = false;
      renderUI(null, false, msg.count, msg.lastResult);
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }
});
