# 11 · GeekPie 仓库分析：EAMS 抓取与 NextDDL

> 分析对象：`github.com/ShanghaitechGeekPie` 下的 `EAMS-Course-Scraper` 与 `NextDDL`
> 分析日期：2026-10-19
> **结论先行：一个可以合法借鉴（MIT），另一个只能学架构（无许可证）—— 且后者的核心做法我们明确不采用。**

---

## 1. 定位说明：这才是「better eams」

用户最初说的「GeekPie 的 GitHub 上的 better eams」，我之前用 `geekpie` 组织名搜不到
（GitHub 上的组织名是 **`ShanghaitechGeekPie`**）。

该组织下有 30+ 个仓库，与本项目直接相关的两个是：

| 仓库 | 是什么 | 许可证 |
| --- | --- | --- |
| **`EAMS-Course-Scraper`** | 在 EAMS 选课页面**控制台运行**的课程列表抓取脚本，导出 JSON | ✅ **MIT** |
| **`NextDDL`** | 多平台 DDL 聚合应用（Hydro / Gradescope / Blackboard） | ❌ **无 LICENSE 文件** |

其它相关的：`coursebench-*`（课程评价）、`ShanghaiTech-Mail-TOTP`（邮箱 TOTP）、
`NextDDL`、`geektrust`、`WikiTech`。

---

## 2. `EAMS-Course-Scraper` —— MIT，**可以合法借鉴**

### 2.1 它是什么

174 行单文件 `console.js`。用户在**上海科技大学 EAMS 选课系统**的课程列表页
打开浏览器控制台，粘贴运行，脚本自动翻完所有页并下载一个 JSON。

**关键点：它全程跑在用户自己的浏览器里，不经过任何服务器，不接触密码。**

### 2.2 技术做法（三处值得学）

**① 靠 DOM 的稳定属性定位，不靠位置**
```js
const rows = document.querySelectorAll('tr[id^="lesson"]');   // 每行 id 形如 lesson12345
const lessonId = row.id.replace('lesson', '').trim();          // 从 id 反推课程 id
```
用 `id` 前缀而不是 `tr:nth-child(n)` —— 页面加一行公告不会让抓取全错位。

**② 翻页靠分页控件的 `pageno` 属性，不靠猜总数**
```js
const lastPageButton = document.querySelector('a.pgLast');
const totalPages = parseInt(lastPageButton.getAttribute('pageno'), 10);
```
先读末页按钮上的页码，再决定翻几次。比"翻到按钮消失为止"更省请求也更可控。

**③ 有两种运行模式，默认让人确认**
脚本开始时弹一次 `confirm`：确认 → 全自动翻完；取消 → 每页都问一次。
对"会改动页面状态"的自动化，**默认把控制权交回给人**是对的。

### 2.3 一个必须注意的细节

它把表头 `headerKeys` 和每行 `td` **按下标配对**：
```js
const tds = row.querySelectorAll('td');
for (let i = 0; i < tds.length; i++) {
  const key = headerKeys[i];
  collectedData[key] = ...
}
```
这个做法**很脆**：EAMS 一改列顺序或插一列，整份导出的字段就全错位，
而脚本不会报错 —— 你会拿到一份"看起来正常但字段全错"的 JSON。

**我们的做法不同**：如果将来做 EAMS 采集，会**从表头文字反查列下标**
（`th` 的文本 → 下标），并在字段缺失时**显式报错**而不是错位填充。

### 2.4 我们能怎么用（MIT 允许什么）

MIT 允许：使用、复制、修改、合并、发布、再许可、销售，**只需保留版权声明与许可声明**。

所以对这个仓库，我们**可以**：
- 直接阅读并借鉴逻辑（这是所有许可证下都允许的）
- 复制代码片段，只要在文件头保留 `Copyright (c) 2025 Geek Pie Association @ ShanghaiTech University` 与 MIT 声明

**但我们选择不复制它的代码**，只借思路 —— 理由不是法律，是**技术**：
它的 `td` 按下标配对、无类型、无测试、无错误处理，与我们 codebase 的质量线不匹配。
用 MIT 代码换来一个"以后每次 EAMS 改版都会静默错位"的模块，不划算。

---

## 3. `NextDDL` —— 无许可证，**只学架构**

### 3.1 它是什么

Next.js 16 + React 19 + PostgreSQL，约 4,200 行 TS/TSX。
把 **Hydro / Gradescope / Blackboard** 三个平台的作业与截止日期聚到一处，
支持 ICS 日历导出、手动添加、状态流转。

功能面与我们的 DDL 模块高度重叠 —— 这是本项目最直接的对标对象。

### 3.2 它的认证做法（**我们不采用**）

`lib/fetch-ddls.ts` 里有三个登录函数：

```ts
loginHydroSession(url, username, password): Promise<CookieMap>
loginGradescopeSession(email, password): Promise<CookieMap>
loginBlackboardSession(studentId, password): Promise<CookieMap>
```

`lib/credential-vault.ts` 里有两档：
```ts
type AuthMode = "session" | "credentials"
// "session"     → 只存 cookies（加密）
// "credentials" → 存 username + password（加密），每次同步时重新登录
```

还有按用户派生密钥的 `encryptCredentialsPayloadForUser(userId, fields)`。

**这是服务端代持学生密码并重放登录。**

### 3.3 为什么我们明确不做这件事

不是因为"技术上做不到"，是因为三个具体的后果：

**① 我们的数据库会变成高价值攻击目标。**
一个持有全校学生 Gradescope / Blackboard 密码的库，哪怕加密，
也是"拿到密钥就一次全拿"。而我们的安全投入是学生项目级别的 ——
**不该主动给自己造一个值得被攻击的目标**。

**② 它必然违反各平台 ToS。**
Gradescope / Blackboard 的服务条款都禁止"以自动化方式使用他人凭据"。
一个学生项目去做这件事，风险落在学生身上。

**③ 密码一旦泄露，用户损失不止于本平台。**
学生会用同一个密码注册别的服务。这是"我们没做好"直接变成"他被撞库"。

### 3.4 它做对、值得学的三件事

**① 两档 AuthMode 的分离本身是个好抽象**
`"session"`（只存 cookie）与 `"credentials"`（存密码）分开，
意味着**可以只支持前者**。我们如果要支持会话复用，就该只做 `"session"` 这一档。

**② ICS 导出**
`app/api/ics/[token]/route.ts` + `ics-token` 端点：给用户一个带 token 的
日历订阅 URL，让 DDL 直接进他的系统日历。**这个功能我们完全没有**，
而且它**不需要任何平台凭据** —— 只是把我们已有的 DDL 渲染成 ICS。

**③ `platform-session-status`**
单独一个端点回答"这个平台的会话还有效吗"，而不是让同步失败来暴露。
这比"猜"要好：用户能提前知道"该重新登录了"。

### 3.5 许可证裁决

`NextDDL` **没有 LICENSE 文件** → 保留所有权利。

| 做法 | 判定 |
| --- | --- |
| 读它的架构、理解它怎么组织 DDL 聚合 | ✅ |
| 复制 `fetch-ddls.ts` / `credential-vault.ts` 的代码 | ❌ |
| 翻译/改名/逐行改写 | ❌ |
| **独立实现 ICS 导出** | ✅（功能不受版权保护） |

---

## 4. 我们的行动计划

| # | 借鉴点 | 来源 | 许可 | 我们怎么做 |
| --- | --- | --- | --- | --- |
| 1 | EAMS 用 `id^=lesson` 定位行、`pageno` 读总页数 | EAMS-Course-Scraper | MIT | 独立实现，且**改为从表头文字反查列** |
| 2 | 自动化默认让人确认 | EAMS-Course-Scraper | MIT | 采集护栏里已经有"每页累积 + 丢页保护" |
| 3 | **ICS 日历导出** | NextDDL | 无 | **独立实现**，不需要平台凭据 |
| 4 | AuthMode 两档分离 | NextDDL | 无 | 只做 `session` 一档，**永不存密码** |
| 5 | `platform-session-status` 端点 | NextDDL | 无 | 独立实现 |

### 明确**不做**

- ❌ 服务端存学生平台密码（无论加密与否）
- ❌ 服务端重放登录（`loginXxxSession`）
- ❌ 复制 `NextDDL` 的任何代码（无许可证）

---

## 5. 方法论记录

**如何找一个组织的 GitHub 仓库**（这次踩的坑）：
用户说「GeekPie 的 GitHub」，我试了 `geekpie` 组织名 → Not Found。
实际组织名是 **`ShanghaitechGeekPie`**。

正确做法：搜 `"GeekPie" site:github.com` 或直接看学校相关仓库的 org 链接，
**不要从中文名猜英文 org 名**。

**GitHub API 限流时的退路**：抓 `https://github.com/orgs/<org>/repositories?type=all`
的 HTML，用 `href="/<org>/<repo>"` 正则提取 —— 比 API 稳。
