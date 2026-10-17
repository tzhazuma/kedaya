# 可达鸭小程序 UI 规范

基础控件固定使用 Taroify，图标使用 Taroify Icons，业务页面通过 Kdy 组件复用品牌样式。
ESLint 会阻止在 presentation 层直接引入 Taro 原始表单控件和其他常见 UI 库。
主题入口为 `apps/miniapp/src/presentation/theme/appearance.scss`，从共享设计令牌映射小程序变量。
共享品牌色保持不变，Web 主题不随本端调整。

## 视觉

- 主色可达鸭黄，暖白页面、白色内容卡片、深蓝灰文字。黄色按钮使用深色文字。
- 页面左右留白 20px，卡片间距 12px，卡片圆角 16px，正文 14–16px。
- 375px 为设计基准；Taro 将 CSS px 转换为 rpx，避免把现有令牌错误地缩小一半。
- 首页重点卡片允许半透明背景与轻磨砂，降级背景仍可独立保证文字可读；列表卡片使用实色。
- 图标统一线性风格，品牌形象可使用原创资源；不混用 emoji 与多套图标。
- 主次按钮、标签、加载、空态与进度使用统一封装；新表单、弹层、选择器直接优先选 Taroify。

## 标准件

新增页面前先找可复用的 Kdy 组件，不要另起一套基础控件：

| 组件 | 用途 |
| --- | --- |
| `KdyButton` | 主/次/幽灵/危险按钮，`block` 撑满，`loading` 表示提交中；`openType` 可透传 `share` / `chooseAvatar` |
| `KdyAvatar` | 头像展示（无图回退吉祥物图标）；**选择**头像由页面上的 `KdyButton openType='chooseAvatar'` 触发 |
| `KdyCard` | 内容卡片容器（`title` / `extra` / `onClick`） |
| `KdyField` | **表单唯一入口**（Taroify Field + Input 薄封装，支持 `type`（含 `nickname`）/ `maxLength` / `hint`） |
| `KdyChip` | 可点击胶囊：筛选器与单选（分类、成色、状态、排序）都用它 |
| `KdyTag` | 状态标签，`tone` 取语义色，不要自己写色值 |
| `KdyEmpty` | `loading / empty / error` 三态占位，可带行动按钮（重试、去发布） |
| `KdyHeading` | 页面标题区（`title` / `subtitle` / `eyebrow`） |

列表页与详情页的状态机统一走 `application/common/{listUseCase,detailUseCase}.ts`：
`hydrate()` 同步出缓存、`load()` 后台刷新、失败静默降级。页面只读 `useStore(...)` 的快照，
不要自己写 loading 布尔值。

`domain` 与 `application` 层禁止 import `data/**` 或 `@tarojs/*`（ESLint 强制），
平台能力一律经 `src/platform/**` 适配层。

## 页面与交互

首页包含品牌欢迎区、常用服务、完整服务入口与心理支持入口。
服务入口来自共享模块契约；未实现模块明确提示，不能伪造数据或可用状态。
已实现模块的入口集中在首页 `MODULE_ROUTES`，新增模块时同时登记路由与页面清单。

账号：登录 / 注册 / 找回密码 / 修改密码 / 绑定邮箱五页共用 `auth/auth.scss` 与 `KdyField`；
表单错误在字段下方即时提示，提交失败用后端返回的文案。
Mock 演示账号（`demo@kedaya.dev` / `Kedaya2026`）必须在登录页明确标注为演示用。

微信快捷注册 / 登录是**第一级身份层的第三条入口**，与邮箱密码对等：

- 登录页与注册页都提供「微信一键登录 / 注册」，走 `presentation/hooks/useWechatAuth.ts`
  这段共用编排（取凭证 → 调用例 → 首次建号去完善资料 → 否则回原页），不要各写一份。
- 昵称取不到时后端兜底为 `微信用户<四位>`；`isNewUser` 为 true 时跳
  「完善资料」（`profile/edit?from=wechat`，带跳过按钮），不强迫填写。
- 微信侧的硬约束决定了表单写法：昵称必须用 `KdyField type='nickname'`
  （键盘给「使用微信昵称」），头像必须由用户点 `KdyButton openType='chooseAvatar'` 触发，
  回调给的是临时文件路径，须经 `platform/avatarPicker.ts` 压成 ≤64KB data URL 才能落库。
- 「我的」页展示账号方式概览（邮箱 / 微信 / 校园系统）与对应动作；只剩一种登录方式时
  解绑按钮禁用并说明原因（后端也会拦），不要把「至少保留一种登录方式」写成前端独有规则。
- 开发模式下微信身份是本地模拟的（`simulated: true`），界面必须如实标注，不能冒充真实微信身份。

业务模块（跳蚤 / 跑腿 / 找搭子 / 失物招领 / 论坛）统一为「列表 → 发布 → 详情」三页：

- 列表页：关键词 + 筛选胶囊 + 触底加载更多 + 悬浮发布按钮（悬浮按钮必须叠加
  `env(safe-area-inset-bottom)`）；空态给出下一步动作而不是只写一句「暂无数据」。
- 详情页：只渲染领域函数允许的动作（`availableActions` 之类），
  未登录时引导登录，不发送注定 401 的请求；破坏性操作前二次确认。
- 发布页：客户端校验与服务端同规则，提交按钮在未通过校验时禁用并说明原因。

宿舍矛盾是匿名模块：进入前必须有二次同意门（同意记录落 `StorageKeys.consent`），
查看进度凭本地保存的追踪码，页面要说明「追踪码丢失后无法找回」，
并给出「紧急情况请直接联系辅导员 / 校园安保」的提示。

发现页的开发工具、Mock 控制保持可用但折叠展示。
消息页保留订阅动作和空态，不制造虚假未读数。详情页保留参团、分享、地图与错误恢复。
全站保留第三方非官方说明。敏感模块的同意判断不能因视觉修改而移除。

## 字体与 WXSS 约束

图标字体**不做网络加载**：`src/presentation/theme/icon-font.scss` 把 Taroify（vant）图标字形
以 base64 内联，并在 `config/index.ts` 里用 alias 接管 `@taroify/icons/style/index.js`
（见 `src/presentation/theme/taroify-icon-style.ts`），先加载官方字形映射再覆盖官方那条
指向 `//at.alicdn.com` 的 `@font-face`。原因：协议相对地址在部分基础库不解析，
真机还必须把 `at.alicdn.com` 加进「下载合法域名」，否则图标全是空白方框。

写样式时不要使用 WXSS 不支持的选择器，否则 `common.wxss` 编译失败、**所有页面一起白屏**：

- 禁止 `.a > :first-child` / `.a > *` 这类「组合器 + 隐式通用选择器」写法，
  改成给子元素显式类名（`.a .kdy-field { flex: 1 }` 这类后代选择器是安全的）。
- 禁止裸 `*` 选择器；`@font-face` 的 `src` 禁止写 http(s) 或 `//` 网络地址。

`src/presentation/theme/__tests__/wxss-safety.test.ts` 会在单测里扫描全部 `.scss` 守住这三条。

## 验证

执行小程序类型检查、现有测试与 weapp 构建。检查小屏、长内容、禁用 / 加载 / 错误状态、
底部安全区，以及微信开发者工具内的图标、原生分享与订阅消息。H5 只作为布局预览。
