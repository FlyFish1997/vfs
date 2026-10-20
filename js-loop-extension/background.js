/**
 * JS Loop Runner - 浏览器扩展
 * 免责声明：本程序仅用于研究学习目的，不保证实际使用效果，请遵循当地法律法规。
 * 交流及版权联系：your-email@example.com
 */

// Background Service Worker - 消息中继、徽章状态、刷新重启管理、代码执行

// 待重启映射: tabId -> { config, originalUrl }
const pendingRestarts = new Map();

// 监听消息
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  // 代码执行请求 —— 需要异步返回结果
  if (msg.type === 'EXEC_CODE') {
    const targetTabId = msg.tabId;
    chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      world: 'MAIN',
      func: (userCode) => {
        try {
          const fn = new Function(userCode);
          const result = fn();
          return result;
        } catch (err) {
          return { __error__: err.message };
        }
      },
      args: [msg.code]
    }).then(results => {
      sendResponse({ result: results[0].result });
    }).catch(err => {
      sendResponse({ result: { __error__: err.message } });
    });
    return true; // 保持通道开放，等待异步 sendResponse
  }

  if (msg.type === 'PREPARE_RELOAD') {
    const id = tabId ?? msg.tabId;
    if (id !== undefined && id !== null) {
      pendingRestarts.set(id, {
        config: msg.config,
        originalUrl: msg.originalUrl
      });
    }
  }

  if (msg.type === 'CLEAR_PENDING') {
    const id = tabId ?? msg.tabId;
    if (id !== undefined && id !== null) {
      pendingRestarts.delete(id);
    }
  }

  if (msg.type === 'LOOP_STOPPED') {
    if (tabId !== undefined) {
      chrome.action.setBadgeText({ text: '', tabId });
    }

    if (msg.reason === 'matched') {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'JS Loop Runner - 循环已停止',
        message: `返回值 "${String(msg.lastResult)}" 匹配目标，共执行 ${msg.count} 次。`
      });
    } else if (msg.error) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'JS Loop Runner - 执行出错',
        message: String(msg.lastResult)
      });
    }
  }

  if (msg.type === 'STATE_UPDATE' && tabId !== undefined) {
    chrome.action.setBadgeText({ text: String(msg.count), tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#4a90d9' });
  }
});

// 监听页面加载完成，触发自动重启
chrome.webNavigation.onCompleted.addListener((details) => {
  const tabId = details.tabId;

  if (details.frameId !== 0) return;

  const pending = pendingRestarts.get(tabId);
  if (!pending) return;

  if (details.url !== pending.originalUrl) {
    pendingRestarts.delete(tabId);
    chrome.action.setBadgeText({ text: '', tabId });
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'JS Loop Runner - 已停止',
      message: `页面 URL 已变化（${new URL(details.url).pathname}），停止循环。`
    });
    return;
  }

  pendingRestarts.delete(tabId);

  setTimeout(() => {
    chrome.tabs.sendMessage(tabId, {
      type: 'AUTO_START',
      config: pending.config,
      tabId
    }).catch(() => {
      setTimeout(() => {
        chrome.tabs.sendMessage(tabId, {
          type: 'AUTO_START',
          config: pending.config,
          tabId
        }).catch(() => {});
      }, 500);
    });
  }, 200);
});

// 标签页关闭时清理
chrome.tabs.onRemoved.addListener((tabId) => {
  pendingRestarts.delete(tabId);
  chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
});
