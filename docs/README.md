# 可达鸭 · 文档索引

> 45 份文档、约 25,100 行。这份索引回答三个问题：
> **「我想知道 X，该读哪篇」**、**「这篇还准吗」**、**「从哪开始」**。

---

## 0. 先读这三份

| 顺序 | 文档 | 为什么 |
| --- | --- | --- |
| 1 | **[README.md](../README.md)**（仓库根） | 项目是什么、怎么跑起来 |
| 2 | **[architecture/00-FROZEN-CONTRACT.md](./architecture/00-FROZEN-CONTRACT.md)** | **唯一真相**。所有其他文档都以它为上游；冲突时它赢 |
| 3 | **[architecture/01-overview.md](./architecture/01-overview.md)** | 系统总览、模块划分、数据流 |

之后再按你的角色挑：
- **改代码** → `02-domain-model` → `03-api-contract` → `04-client-architecture`
- **跑起来** → `local-development` → `deploy`
- **提审/上线** → `review-checklist` → `delivery-plan`
- **查某个校园服务接没接** → `architecture/05-campus-integration-audit`

---

## 1. ⚠️ 关于「这篇还准吗」

文档会腐蚀。下表标出**已知的**新鲜度问题，读之前先看一眼。

| 文档 | 状态 | 说明 |
| --- | --- | --- |
| `architecture/00-FROZEN-CONTRACT` | ✅ **当前** | 冻结契约。改动需走 ADR |
| `architecture/01`–`04` | ✅ 当前 | 基础架构，未过时 |
| `architecture/05-campus-integration-audit` | ✅ **当前**（2026-10-20 校订） | 「哪个校园服务已接通」的真相。已修正 CAS 地址 |
| `architecture/05-security-privacy` | ✅ 当前 | 安全与隐私设计 |
| `architecture/06-roadmap` | ⚠️ **部分过时** | 写于早期，M0–M4 的完成状态以 `delivery-plan` 为准 |
| `architecture/06-prior-art-and-reuse` | ⚠️ **部分被取代** | 写于 2026-10-19，当时判断「只学架构不复制」。**授权已于 10-20 变更** → 见 `12-merged-from-classmates` |
| `architecture/07-auth-methods` | ✅ 当前（10-20 校订） | 五种登录方式盘点。已修正 CAS 真实地址 |
| `architecture/08-reference-merge-plan` | ⚠️ **已被取代** | 第 25 轮的合并计划。实际合并结果见 `12-merged-from-classmates` |
| `architecture/09-qin-apk-analysis` | ⚠️ **部分被取代** | 「秦QIN」逆向分析。**代码已于 10-20 获授权合并** |
| `architecture/11-geekpie-repos-analysis` | ✅ 当前 | GeekPie 两个仓库的分析（EAMS-Course-Scraper / NextDDL） |
| `architecture/12-merged-from-classmates` | ✅ **当前** | **从同学项目合并了什么、没合并什么、为什么**。授权变更的记录 |
| `design/campus-play/*` | ✅ 当前 | UI 风格来源 |
| `features/*` | ✅ 当前 | 各功能规格 |
| `adr/*` | ✅ 当前 | 决策记录，**不改**（改了就不叫记录了） |

**规则**：如果任何文档与 `00-FROZEN-CONTRACT` 冲突，以契约为准；如果与**代码**冲突，先确认代码是不是新的 —— 这几轮已经出现过「文档说没接、代码已接」的情况。

---

## 2. ⚠️ 编号有重复（不是笔误，是历史遗留）

`architecture/` 下有两个 `05`、两个 `06`，且**没有 `10`**：

| 编号 | 两份 | 怎么区分 |
| --- | --- | --- |
| `05` | `05-campus-integration-audit` / `05-security-privacy` | 一份讲**外部对接**，一份讲**内部安全** |
| `06` | `06-prior-art-and-reuse` / `06-roadmap` | 一份讲**参考项目**，一份讲**排期** |
| `10` | 缺失 | 编号在 `09` 之后跳到了 `11` |

**为什么没重命名**：这两个文件名被 **7+ 处**交叉引用（`adr/0004`、`adr/0005`、`delivery-plan` 等）。为了编号好看去改文件名，会让一批链接静默失效 —— 收益远小于风险。

**正确做法**：认**文件名**，不要认编号。文件名本身是自解释的。

---

## 3. 全部文档一览

### 3.1 架构（`architecture/`）

| 文档 | 行数 | 一句话 |
| --- | ---: | --- |
| `00-FROZEN-CONTRACT` | 1305 | **冻结契约**：不变式、模块表、权限域、坐标系、金额单位 |
| `01-overview` | 507 | 系统总览：技术栈、模块划分、数据流 |
| `02-domain-model` | 1198 | 领域模型：实体、关系、状态机 |
| `03-api-contract` | 958 | API 契约：端点、信封、错误码 |
| `04-client-architecture` | 94 | 三端（小程序/Web/Flutter）的架构与分工 |
| `05-campus-integration-audit` | 1208 | **校内服务对接审计**：6 个校园系统各接通到什么程度 |
| `05-security-privacy` | 699 | 安全与隐私：权限域、凭证加密、PIPL 合规 |
| `06-prior-art-and-reuse` | 1199 | 参考项目调研（⚠️ 部分结论被 `12` 取代） |
| `06-roadmap` | 453 | M0–M4 分期路线（⚠️ 完成状态看 `delivery-plan`） |
| `07-auth-methods` | 341 | 五种登录方式 + P0-3 修复说明 |
| `08-reference-merge-plan` | 171 | 第 25 轮合并计划（⚠️ 已被 `12` 取代） |
| `09-qin-apk-analysis` | 199 | 「秦QIN」APK 逆向分析（⚠️ 代码已获授权合并） |
| `11-geekpie-repos-analysis` | 188 | GeekPie 的 EAMS 抓取脚本 + NextDDL 分析 |
| `12-merged-from-classmates` | 465 | **合并记录**：文件级出处、没合并的部分及理由 |
| `13-cas-without-registration` | — | **`CAMPUS_CAS_SERVICE` 是干什么的**，以及不注册的四条替代路线 |
| `14-wechat-content-ingestion` | — | **公众号能否抓取**：单篇可以、批量不行，已实现解析 |
| `15-campus-card-payment-code` | — | **校园卡付款码的真实机制**：只开放解码、不开放生成 |
| `16-miniapp-appid-and-whitelist` | — | **怎么拿真实 appid、怎么配 downloadFile 白名单**（附我能做什么/不能做什么） |
| `17-campus-department-contacts` | — | **上科大 32 个部门真实邮箱 + 电话**（官网实测抓取，含「未找到」清单） |
| `18-ecard-and-wechat-history-findings` | — | **两个「拿不到」的实测结论**：eCard 付款码到不了服务、公众号历史抓不到钥匙 |

### 3.2 功能规格（`features/`）

| 文档 | 行数 | 一句话 |
| --- | ---: | --- |
| `buddy-matching` | 1444 | 找搭子：匹配算法、资料分离、撤回语义 |
| `campus-map-data` | 515 | 校园地图数据与底图 |
| `miniapp-campus-map` | 246 | 小程序校园地图组件 |
| `techpie-integration` | 1139 | TechPie 能力整合（含付款码的能力声明） |
| `wildlife-map` | 1912 | 野生动物活动区域与轨迹 |
| `techpie-native-payment-code` | — | **原生端付款码可行性**：DNS 隧道的权限要求、合规风险清单、鸿蒙评估 |
| `petition` | — | **众筹诉求**：不筹钱、附议匿名、`ready ≠ submitted`、邮件生成的三条硬约束 |
| `teabreak` | — | **会议茶歇**：核心是「多久没被确认」不是列表、20 分钟新鲜度、不谴责蹭会 |

### 3.3 决策记录（`adr/`）

| 文档 | 一句话 |
| --- | --- |
| `0001-monorepo` | 为什么单仓多包 + npm workspaces + Turborepo |
| `0002-miniapp-framework` | 为什么选 Taro 4 而不是 uni-app |
| `0003-mobile-framework` | 为什么原生端选 Flutter |
| `0004-auth-two-tier` | **两级身份必须解耦**（身份层 / 能力层） |
| `0005-brand-and-ip` | 「可达鸭」的商标/IP 风险与规避 |
| `0006-nutrition-butler` | 营养管家的数据可信度边界 |
| `0007-campus-sticker-ui` | UI 统一到「校园贴纸簿」 |

### 3.4 运维与交付

| 文档 | 行数 | 一句话 |
| --- | ---: | --- |
| `local-development` | 384 | 本机怎么跑起来 |
| `deploy` | 792 | 部署到微信云托管（CloudBase Run） |
| `delivery-plan` | 815 | 上线交付计划（可执行轮次） |
| `review-checklist` | 208 | 提审材料清单 |
| `miniapp-ui` | 297 | 小程序 UI 规范 |
| `design/campus-play/*` | 70 | UI 风格的设计与核对 |
| `development/wechat-agent-automation` | 50 | 微信 Agent 自动化开发 |

---

## 4. 已经上线的、但**不在**任何规格文档里的事实

这几轮的工作有相当一部分直接落在代码 + 提交信息里，规格文档没跟上。
这里集中记一笔，免得下一个人从 34 份文档里找不到：

| 能力 | 在哪 | 文档状态 |
| --- | --- | --- |
| **统一身份认证（CAS）真实 provider** | `services/api/src/modules/auth/data/http-campus-auth.provider.ts` | ❌ 无独立规格；见 `07-auth-methods` §5 |
| **账号注销（PIPL 自助）** | `modules/auth/application/account-deletion.service.ts` + 小程序「隐私与数据」页 | ❌ 无规格；设计理由在文件头注释 |
| **DDL 聚合 + 多平台解析** | `packages/shared/src/deadline-*` + 小程序 DDL 页 | ❌ 无规格；见 `12-merged-from-classmates` |
| **Web 端 DDL 导入页 `/import`** | `apps/web/src/features/deadline-import/` | ❌ 无规格 |
| **校园地点（POI）+ 一图通授权照片** | `apps/miniapp/.../campusPoi*` | ⚠️ `features/miniapp-campus-map` 部分覆盖 |
| **教务课表导入** | `apps/miniapp/src/application/schedule/eamsImport.ts` | ❌ 无规格 |
| **邮件 IMAP 接入** | `services/api/src/modules/mail/` | ❌ 无规格 |

**如果要把文档补齐，优先补这七个。** 每份大约一页：

1. 它解决什么问题（用户视角）
2. 数据从哪来、边界在哪
3. 失败时怎么办
4. 已知缺口

---

## 5. 维护这份索引的规则

1. **新增文档 → 一定加进第 3 节**，否则它等于不存在
2. **文档被取代 → 不要删**，在第 1 节标「已被 X 取代」。保留当时的判断本身就是信息
3. **代码改了但文档没改 → 先改文档**。这几轮已经出现过「文档说没接、代码已接」的误导
4. **不要为了编号好看重命名**（见第 2 节）
