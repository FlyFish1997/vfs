/**
 * JS Loop Runner - 浏览器扩展
 * 免责声明：本程序仅用于研究学习目的，不保证实际使用效果，请遵循当地法律法规。
 * 交流及版权联系：your-email@example.com
 */

// Content Script - 在页面上下文中定时执行用户 JS 代码

let timerId = null;
let count = 0;
let lastResult = undefined;
let running = false;
let tabId = null;
let config = { code: '', interval: 1000, stopReturn: '', refreshReturn: '' };

// 委托 background service worker 在 MAIN world 中执行用户代码
// content script 无权直接调用 chrome.scripting API
async function executeInMainWorld(code) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'EXEC_CODE',
      code,
      tabId
    });
    return response.result;
  } catch (err) {
    return { __error__: err.message };
  }
}

// 单次执行
async function executeOnce() {
  if (!running) return;

  try {
    const result = await executeInMainWorld(config.code);

    // 检查是否是错误对象
    if (result && typeof result === 'object' && result.__error__) {
      notifyPopup({ type: 'LOOP_STOPPED', count, lastResult: 'Error: ' + result.__error__, error: true });
      stopLoop();
      return;
    }

    count++;
    lastResult = result;

    const matchedStop = matchResult(result, config.stopReturn);
    const matchedRefresh = matchResult(result, config.refreshReturn);

    notifyPopup({ type: 'STATE_UPDATE', count, lastResult: result });

    // 刷新优先：同时匹配时刷新优先于停止
    if (matchedRefresh) {
      notifyPopup({ type: 'LOOP_STOPPED', reason: 'reloading', count, lastResult: result });
      chrome.runtime.sendMessage({
        type: 'PREPARE_RELOAD',
        tabId: null,
        config: config,
        originalUrl: location.href
      });
      stopLoopWithoutNotify();
      console.log('[JS Loop Runner] 返回值 "%s" 匹配刷新状态码 "%s"，即将刷新页面（已执行 %d 次）',
        String(result), config.refreshReturn, count);
      location.reload();
      return;
    }

    if (matchedStop) {
      notifyPopup({ type: 'LOOP_STOPPED', reason: 'matched', count, lastResult: result });
      stopLoop();
      return;
    }
  } catch (err) {
    count++;
    lastResult = 'Error: ' + err.message;
    notifyPopup({ type: 'STATE_UPDATE', count, lastResult, error: true });
  }
}

// 用于比较返回值与目标值
function matchResult(result, target) {
  if (target === '' || target === undefined || target === null) return false;

  const targetNum = Number(target);
  const resultNum = Number(result);

  if (!isNaN(targetNum) && !isNaN(resultNum) && String(target).trim() !== '' && String(result).trim() !== '') {
    return resultNum === targetNum;
  }

  return String(result) === String(target);
}

// 通知 popup / background（如果打开着）
function notifyPopup(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

// 启动循环
function startLoop(cfg, id) {
  if (running) stopLoop();

  config = cfg;
  if (id !== undefined) tabId = id;
  count = 0;
  lastResult = undefined;
  running = true;

  executeOnce();

  timerId = setInterval(() => {
    executeOnce();
  }, config.interval);
}

// 停止循环
function stopLoop() {
  notifyPopup({ type: 'CLEAR_PENDING' });
  stopLoopWithoutNotify();
}

function stopLoopWithoutNotify() {
  running = false;
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
}

// 监听消息
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'START':
      startLoop(msg.config, msg.tabId);
      sendResponse({ success: true });
      break;

    case 'STOP':
      stopLoop();
      sendResponse({ success: true });
      break;

    case 'AUTO_START':
      startLoop(msg.config, msg.tabId);
      sendResponse({ success: true });
      break;

    case 'GET_STATE':
      sendResponse({ running, count, lastResult, stopReturn: config.stopReturn, refreshReturn: config.refreshReturn });
      break;
  }
});
