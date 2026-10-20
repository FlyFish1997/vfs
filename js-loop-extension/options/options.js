/**
 * JS Loop Runner - 浏览器扩展
 * 免责声明：本程序仅用于研究学习目的，不保证实际使用效果，请遵循当地法律法规。
 * 交流及版权联系：your-email@example.com
 */

// 加载已保存的配置
document.addEventListener('DOMContentLoaded', async () => {
  const defaults = {
    code: '',
    interval: 1000,
    stopReturn: '',
    refreshReturn: ''
  };

  try {
    const result = await chrome.storage.sync.get(defaults);
    document.getElementById('code').value = result.code;
    document.getElementById('interval').value = result.interval;
    document.getElementById('stop-return').value = result.stopReturn;
    document.getElementById('refresh-return').value = result.refreshReturn;
  } catch {
    // 使用默认值
  }
});

// 保存配置
document.getElementById('options-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const config = {
    code: document.getElementById('code').value,
    interval: Math.max(100, parseInt(document.getElementById('interval').value, 10) || 1000),
    stopReturn: document.getElementById('stop-return').value,
    refreshReturn: document.getElementById('refresh-return').value
  };

  try {
    await chrome.storage.sync.set(config);
  } catch {
    // fallback to local storage
    await chrome.storage.local.set(config);
  }

  const status = document.getElementById('save-status');
  status.textContent = '已保存';
  status.classList.add('visible');
  setTimeout(() => status.classList.remove('visible'), 2000);
});
