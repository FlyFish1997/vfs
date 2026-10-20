# JS Loop Runner

> 在网页中定时循环执行你指定的 JavaScript 代码，按返回值自动停止循环或刷新页面重来。

一个零依赖、无需构建的 Chrome / Edge 扩展（Manifest V3）。典型用途是**轮询页面状态**：每隔一段时间跑一段脚本，当接口返回「有货 / 可预约」时自动停下并通知你，或在「限流 / 需要刷新」时自动刷新页面继续排队。

---

## 目录

- [特性](#特性)
- [快速开始](#快速开始)
- [配置项](#配置项)
- [JS 代码约定](#js-代码约定)
- [工作原理](#工作原理)
- [项目结构](#项目结构)
- [权限说明](#权限说明)
- [示例代码](#示例代码)
- [常见问题](#常见问题)
- [免责声明](#免责声明)
- [License](#license)

---

## 特性

| 能力 | 说明 |
| --- | --- |
| 定时循环执行 | 按设定间隔在页面上下文中重复执行你的 JS 代码 |
| 停止状态码 | 返回值命中目标值时自动停止循环，并弹出系统通知 |
| 刷新状态码 | 返回值命中目标值时刷新页面，页面加载完成后自动继续循环 |
| 执行计数 | 扩展图标上的徽章实时显示已执行次数 |
| 页面变化保护 | 刷新过程中若 URL 发生变化（例如跳转到登录页），立即停止并提示 |
| 自动注入 | 目标页面尚未注入 content script 时，弹窗会尝试程序化注入 |
| 配置同步 | 配置存放于 `chrome.storage.sync`，不可用时自动回退到 `chrome.storage.local` |

---

## 快速开始

### 1. 安装扩展

1. 打开 `chrome://extensions`（Edge 为 `edge://extensions`）
2. 右上角开启 **开发者模式**
3. 点击 **加载已解压的扩展程序**，选择本仓库中的 `js-loop-extension` 目录

> 本项目不需要 `npm install`，也没有打包步骤，克隆下来即可直接加载。

### 2. 编写要循环执行的代码

代码在选项页配置，**必须用 `return` 返回一个值**，这个值会被拿去和目标状态码比较：

```js
// 最小示例：返回页面上的某个状态文本
const el = document.querySelector('.appointment-status');
return el ? el.textContent.trim() : null;
```

### 3. 配置参数

点击扩展图标 → **选项**（或右键扩展图标 → 选项），填写：

- **JS 代码**：要循环执行的函数体
- **循环间隔**：毫秒，最小 `100`
- **停止状态码**：例如 `1`、`done`、`200`
- **刷新状态码**：例如 `0`、`retry`、`429`

保存后回到目标页面。

### 4. 启动循环

1. 切换到要监控的页面
2. 点击扩展图标 → **启动**
3. 徽章开始计数，弹窗显示最近一次返回值

命中「停止状态码」时循环结束并发送通知；命中「刷新状态码」时页面自动刷新，加载完成后循环自动恢复。

---

## 配置项

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `code` | string | `""` | 要执行的 JS 函数体，必须 `return` |
| `interval` | number | `1000` | 循环间隔（毫秒），保存时强制下限 `100` |
| `stopReturn` | string | `""` | 停止目标值，留空表示不启用停止匹配 |
| `refreshReturn` | string | `""` | 刷新目标值，留空表示不启用刷新匹配 |

配置存储键与上表字段名一一对应，可在 `chrome://extensions` → 扩展详情 → 「检查视图：存储」中查看。

---

## JS 代码约定

### 1. 代码被当作函数体执行

扩展内部等价于：

```js
const fn = new Function(userCode);   // userCode 会被包成函数体
const result = fn();
```

因此：

- 顶层 `return` 合法，可以直接返回结果
- 支持 `const` / `let` / 模板字符串 / 箭头函数等任意语法
- 代码运行在 **MAIN world**，因此可以访问页面自己的全局变量、`window`、`$`（jQuery）等
- 执行抛出的异常会被捕获并展示在弹窗的「最近返回」中，同时终止循环

### 2. 返回值比较规则

由 `matchResult(result, target)` 实现：

1. 目标值为空 → 永不匹配
2. 结果与目标**都能转成非 NaN 数字**，且双方字符串非空 → 按**数值相等**比较（`1` == `"1"` 视为匹配）
3. 否则按**字符串全等**比较（区分大小写）

### 3. 停止与刷新的优先级

当同一次执行的结果**同时**命中停止状态码和刷新状态码时，**刷新优先**：页面会先刷新，重新加载后继续循环。

### 4. 常见返回约定示例

```js
// 用数字表示状态机
return 0;   // 未就绪      -> 继续轮询
return 1;   // 成功        -> 停止状态码填 1
return 429; // 被限流      -> 刷新状态码填 429
```

---

## 工作原理

```
┌──────────┐  START/STOP   ┌───────────────┐  EXEC_CODE   ┌──────────────────┐
│  popup   │ ────────────► │  content.js   │ ───────────► │ background.js    │
│ (UI)     │ ◄──────────── │ (定时器/比较)  │ ◄─────────── │ (Service Worker) │
└──────────┘  STATE_UPDATE └───────────────┘   结果       └──────────────────┘
                                 │                                    │
                                 │ location.reload()                 │ chrome.scripting
                                 ▼                                    │ .executeScript
                          ┌─────────────┐                            │ (world: MAIN)
                          │  页面刷新    │ ◄──────────────────────────┘
                          └─────────────┘
                                 │ webNavigation.onCompleted
                                 ▼
                          background 检测到 URL 未变 → 发送 AUTO_START → 循环恢复
```

各模块职责：

| 文件 | 职责 |
| --- | --- |
| `manifest.json` | MV3 清单：权限、入口、content script 注册 |
| `background.js` | Service Worker。消息中继、在 MAIN world 执行用户代码、徽章计数、系统通知、刷新后自动重启的状态管理 |
| `content.js` | 页面侧的定时器与状态机：按间隔触发执行、比较返回值、命中后广播停止/刷新指令 |
| `popup/` | 弹窗 UI：启动 / 停止、显示间隔与目标值、实时轮询执行次数与最近返回值 |
| `options/` | 选项页：编辑并保存上述四项配置 |
| `icons/` | 扩展图标（16 / 48 / 128） |

### 刷新后自动重启的细节

- 命中刷新状态码时，content script 先向 background 登记 `PREPARE_RELOAD`（含配置与原始 URL），再 `location.reload()`
- `background.js` 通过 `webNavigation.onCompleted` 感知加载完成，把配置原样发回 content script 触发 `AUTO_START`
- 若刷新后 **URL 发生变化**（例如被重定向到登录页），background 会取消待重启状态、清空徽章并发送「已停止」通知，避免在错误页面上空转
- 标签页被关闭时，待重启记录会被自动清理

---

## 项目结构

```
.
├── README.md
├── LICENSE
├── .gitignore
├── js-loop-extension/          # 扩展根目录（直接加载此目录）
│   ├── manifest.json
│   ├── background.js
│   ├── content.js
│   ├── icons/
│   │   ├── icon16.png
│   │   ├── icon48.png
│   │   └── icon128.png
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.css
│   │   └── popup.js
│   └── options/
│       ├── options.html
│       ├── options.css
│       └── options.js
├── jscode.txt                 # 示例脚本：状态码 / 成功跳转
└── jscode_re.txt              # 示例脚本：状态码 / 重新预约
```

---

## 权限说明

| 权限 | 用途 |
| --- | --- |
| `storage` | 保存 JS 代码、间隔与目标状态码 |
| `activeTab` | 在用户主动操作后访问当前标签页 |
| `scripting` | 在页面 MAIN world 中执行用户代码 |
| `notifications` | 循环停止、执行出错、URL 变化时发送系统通知 |
| `webNavigation` | 感知刷新后的页面加载完成，以便自动恢复循环 |
| `<all_urls>` (host_permissions) | 需要在任意站点执行脚本 |

> 由于扩展申请了 `<all_urls>`，在 Chrome 扩展详情页中可能需要对具体站点手动授予「允许访问网站」权限。

---

## 示例代码

仓库根目录的 `jscode.txt` 与 `jscode_re.txt` 是**示例代码片段**，用于演示本扩展推荐的写法：

- 代码本身作为**函数体**书写（顶层 `return`）
- 通过页面隐藏字段取出请求参数，再调用页面自身的 AJAX 接口
- 以数字返回值表达状态机：`1` 成功、`2` 稍后重试、`3` 暂不可用、`4` 需等待冷却、`其他` 错误

```js
// 简化示意
const requestId = $("#GlobalRequestId").val();
const sessionId  = $("#Globalsessionid").val();
const sessionToken = $("#Globalsessiontoken").val();

$.ajax({
  url: "../../api/someEndpoint/",
  type: "POST",
  data: JSON.stringify({ request_id: requestId, session_id: sessionId, session_token: sessionToken }),
  dataType: "json",
  success: function (res) {
    return res.status; // 交由扩展与目标状态码比较
  }
});
```

**使用提醒：**

- 这些片段面向特定的业务系统，接口路径与字段名仅作示意；请替换为你**有权访问**的接口后再使用
- 示例中通过 jQuery 发起同步请求，请在目标页面确实提供 `$`（或自行改写为 `fetch`）的前提下使用
- 轮询频率请遵守目标站点的服务条款与当地法律法规，避免造成压力

---

## 常见问题

**Q：点击「启动」没反应？**
扩展会尝试自动注入 content script。若仍失败，请先刷新一次目标页面再启动。首次安装扩展后，已打开的标签页需要刷新才会注入脚本。

**Q：停止状态码不生效？**
检查代码是否真的 `return` 了值。未返回值的表达式会得到 `undefined`，无法与任何目标值匹配；另外注意 `0` 与 `""` 这类假值会被原样比较，不会被忽略。

**Q：配置保存后没反应？**
优先写入 `chrome.storage.sync`，若浏览器未登录或该 API 不可用会自动回退到 `chrome.storage.local`。在扩展详情页的「检查视图：存储」中可确认实际写入位置。

**Q：循环跑得太快影响页面？**
把间隔调大（建议 ≥ 500ms）。间隔低于 `100ms` 会在保存时被强制提升到 `100`。

**Q：刷新后为什么停了？**
若刷新导致页面 URL 变化（跳登录页、被重定向），扩展会主动停止以免在错误页面上继续执行。请在目标页面登录态有效的情况下使用。

---

## 免责声明

本程序仅用于研究学习目的，不保证实际使用效果，请遵循当地法律法规。请勿将其用于违反目标网站服务条款、批量压测或绕过任何访问控制的行为，使用者需自行承担由此产生的全部责任。

---

## License

[MIT](LICENSE) © JS Loop Runner contributors

交流及版权联系：your-email@example.com
