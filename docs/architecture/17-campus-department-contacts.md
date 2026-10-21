# 上科大各部门联系方式（实测抓取）

> 抓取日期：2026-10-22（Asia/Shanghai）
> 目标：给 `packages/contracts/src/petitions.ts` 的 `PETITION_DEPARTMENTS` 提供**有出处的真实地址**。
> 结论先行：**食堂/物业/宿舍没有专属邮箱**，但找到了主管它们的**公共服务处 `ogs@shanghaitech.edu.cn`**；此前「后勤无邮箱」的结论是漏查。

---

## 0. 抓取方法与可信度分级

### 0.1 方法

| 步骤 | 做法 |
| --- | --- |
| HTTP 抓取 | `curl -sL --max-time 25 -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"` |
| 静态站遍历 | 自写 Python 爬虫，只跟同域链接，记录每页 HTTP 码、邮箱、电话 |
| 动态/附件内容 | 迎新网正文是 PDF 内嵌 → 下载 PDF，用 macOS **PDFKit** 抽文本 |
| 图片正文 | 教务处「联系我们」是 JPG → 用 macOS **Vision** OCR（`zh-Hans`） |
| 域名是否存在 | 阿里 DoH `223.5.5.5/resolve`，区分 **NXDOMAIN** 与 Clash fake-ip 的 `198.18.x.x` |
| 未做的事 | **没有发测试邮件**（避免骚扰部门），所以「真实」= 官网公开，不等于已实测可收信 |

### 0.2 可信度分级

| 级别 | 判据 | 本次数量（与 6 类诉求相关） |
| --- | --- | --- |
| **已确认** | 出现在官网正文，且≥2 个不同页面；或 1 个官网正文 + 电话/人员表能交叉对上 | 6 个（`office@` `student@` `ogs@` `it-support@` `facility@` `studentaffairs@`） |
| **单来源** | 只在 1 个页面出现、且没有电话/人员表可交叉验证 | `it@`、`ocpd@`、书院别名等辅助地址 |
| **未找到** | 试过≥5 个入口/域名，没有公开地址 | 食堂专属、宿舍专属、报修专属、校长信箱 |

> `studentaffairs@` 只出现在 1 个页面，但该页是官网正文，且电话 20685643 与学生事务处人员表（闫格，学生事务）对得上，因此归入「已确认」，置信度标 **中高** 而不是 **高**。

> ⚠️ 关键区分：**「官网公布了」≠「这个信箱有人看」**。本报告只证明前者。
> 学校域名在 Clash fake-ip 下会被 `browser_*` / `web_fetch` 拒绝，所以全程用 `curl`；`curl` 走系统网络，能正常拿到 200。

### 0.3 一个必须先纠正的事实

学校**没有叫「后勤服务中心」的部门**。管后勤的实体是：

> **公共服务处（党委保卫部）**，英文 **Office of General Services (OGS)**
> 职责：楼宇物业、**餐饮住宿**、能源中心、交通保障、配套服务、治安消防、快递物流、体育设施、会务接待、环境绿化、医疗健康。

来源：<https://www.shanghaitech.edu.cn/2018/0302/c2598a17524/page.htm>（HTTP 200）
以及英文页 <https://www.shanghaitech.edu.cn/en/2018/0130/c1765a14719/page.htm>（HTTP 200）。

所以 `canteen` / `facility` 应该找 **公共服务处**，而不是「设备与资产处」，更不是编一个 `logistics@`。

---

## 1. 已确认（≥2 个来源或官网正文）

### 1.1 与「众筹诉求」六类直接相关的

| 部门（官方名） | 邮箱 | 电话 | 来源 URL | 可信度 |
| --- | --- | --- | --- | --- |
| **教务处**（Office of Undergraduate Programs） | `student@shanghaitech.edu.cn` | 86-21-20685313 | ① <https://www.shanghaitech.edu.cn/1003/list.htm> ② 教务处「联系我们」图片 OCR：<https://oaa.shanghaitech.edu.cn/2018/1015/c4074a34510/page.htm> ③ 英文页：<https://www.shanghaitech.edu.cn/en/administrative/list.htm> | **高**（3 页；中英文电话不同，见 §1.3） |
| **学生事务处（党委学生工作部）** | `studentaffairs@shanghaitech.edu.cn` | 86-21-20685643 | ① <https://www.shanghaitech.edu.cn/1003/list.htm> ② 电话与人员表对上：<https://xsc.shanghaitech.edu.cn/ryjs/list.htm>（闫格，学生事务，`yange1@`，021-2068 5643） | **中高**（邮箱仅 1 页，但电话/职责交叉验证一致） |
| **公共服务处（OGS，后勤/餐饮/物业）** | `ogs@shanghaitech.edu.cn` | 中文页 86-21-**20684567**；英文页 86-21-**20685167** | ① <https://www.shanghaitech.edu.cn/1003/list.htm> ② <https://www.shanghaitech.edu.cn/en/2018/0130/c1765a14719/page.htm> ③ <https://www.shanghaitech.edu.cn/en/administrative/list.htm> | **高**（3 页；电话两版不一致，见 §1.3） |
| **图书信息中心 / 信息化服务（IT）** | `it-support@shanghaitech.edu.cn` | 86-21-20685566 | ① <https://it.shanghaitech.edu.cn/> ② <https://it.shanghaitech.edu.cn/lxwm/list.htm> ③ 迎新《生活手册》PDF：<https://fresh.shanghaitech.edu.cn/2026/0617/c1890a1124286/page.htm>（原文「IT运维服务邮箱」） | **高**（3 页，且是服务台工单邮箱） |
| **综合办公室（行政）** | `office@shanghaitech.edu.cn` | 86-21-20685160 | ① <https://www.shanghaitech.edu.cn/1003/list.htm> ② <https://www.shanghaitech.edu.cn/en/administrative/list.htm>（University Office） | **高**（2 页） |
| **设备与资产处**（OFM） | `facility@shanghaitech.edu.cn` | 86-21-20685211 | ① <https://www.shanghaitech.edu.cn/1003/list.htm> ② <https://www.shanghaitech.edu.cn/en/administrative/list.htm>（OFM：设备/设施/仪器/资产采购管理） | **高**（2 页，但语义陷阱见 §5） |

### 1.2 其他已确认、可作辅助的地址

| 部门 | 邮箱 | 电话 | 来源 | 备注 |
| --- | --- | --- | --- | --- |
| 校医务室 | `clinic@shanghaitech.edu.cn` | 86-21-20685120 | 迎新 PDF 两份：《医疗保障》<https://fresh.shanghaitech.edu.cn/2026/0618/c1890a1124451/page.htm>、《生活手册》<https://fresh.shanghaitech.edu.cn/2026/0617/c1890a1124286/page.htm> | 正文明确「学校医务室邮箱」 |
| 书院办公室 | `life@shanghaitech.edu.cn` | 86-21-20685136 | <https://www.shanghaitech.edu.cn/1003/list.htm> | 仅 1 页；英文页把同一电话配了 `student@`，见 §1.3 |
| 研究生院 | `gadmission@shanghaitech.edu.cn` | 86-21-20685449 | ① <https://www.shanghaitech.edu.cn/1003/list.htm> ② <https://oaa.shanghaitech.edu.cn/2022/1102/c4074a952049/page.htm> | 招生事务为主 |
| 心理咨询中心 | `share@shanghaitech.edu.cn` | 86-21-20685560 | <https://life.shanghaitech.edu.cn/xlzx/list.htm> 等 3 页 | 心理支持，非诉求受理 |
| 校园一卡通受理中心 | —（只公布电话） | 86-21-20685112 | 《生活手册》 | 地点：校园服务中心 2 楼（H1 楼 B 区 203 室） |

### 1.3 官网自相矛盾的地方（不要替它圆）

| 项目 | 中文「联系我们」 | 英文页 | 处理建议 |
| --- | --- | --- | --- |
| 教务处电话 | 86-21-20685313 | 86-21-20685581 | 以中文页为准；英文页可能旧 |
| 公共服务处电话 | 86-21-20684567 | 86-21-20685167（两处英文页一致） | 两个都保留；优先中文页 |
| 学生事务处邮箱 | `studentaffairs@` + 20685643 | 英文 Student Affairs 页写 `student@` + 20685136 | 中文页更符合现状；英文页疑似复用了书院电话 |
| 财务处邮箱 | `finance@shanghaitech. edu. cn`（中间有空格，排版错误） | `finance@shanghaitech.edu.cn` | 英文页写法正确 |

英文 Student Affairs 页：<https://www.shanghaitech.edu.cn/en/2018/0126/c1765a14161/page.htm>（HTTP 200）

### 1.4 迎新网 `fresh.shanghaitech.edu.cn` 专项（用户点名）

| 项目 | 结果 |
| --- | --- |
| 首页 | HTTP 200，5,042 B；纯静态 WebPlus 站 |
| 遍历 | 19 个页面全部 200（首页、2 个列表页、15 篇正文、main） |
| 正文形态 | **几乎全是内嵌 PDF**：`<div class="wp_pdf_player" pdfsrc="...">`，HTML 里没有文字，所以直接 grep 邮箱会得到 0 |
| PDF 抽取 | 下载 7 份 PDF（共约 25 MB），用 PDFKit 抽文本 |
| 从 PDF 拿到的邮箱 | `clinic@`（医务室，2 份 PDF）、`it-support@`（IT 运维，生活手册）、`library@`、`share@`、`shangdaocollege@` / `kedao@` / `dadao.college@`，以及 11 个辅导员/教师个人邮箱 |
| 没拿到的 | 教务处、学生事务处、公共服务处的**部门邮箱**；迎新须知只写「向学生事务处请假」，不写邮箱 |
| 结论 | fresh 对「医务室 / IT / 书院」有用；对**食堂、宿舍、教务**没有新增部门邮箱 |

示例：<https://fresh.shanghaitech.edu.cn/2026/0810/c1890a1126289/page.htm>（HTTP 200，5,152 B，正文只有 1 个 PDF 播放器）
对应 PDF：`/_upload/article/files/84/b3/e817f6634cc79e99574790d4b8fe/e455fd0e-d24f-41a1-aeef-49cd4e924781.pdf`（HTTP 200，7.5 MB）

---

## 2. 单来源（可能是旧的）

| 部门/用途 | 邮箱 | 来源 URL | 判断 |
| --- | --- | --- | --- |
| 图书信息中心（部门总邮箱） | `it@shanghaitech.edu.cn` | 仅英文页 <https://www.shanghaitech.edu.cn/en/administrative/list.htm>（Library and IT Services 同时列 `library@` + `it@`） | **可能**。中文 IT 站从不提 `it@`，只用 `it-support@`；不要拿它当主地址 |
| 综合办公室（党务） | `ucoffice@shanghaitech.edu.cn` | <https://www.shanghaitech.edu.cn/1003/list.htm> | 真实，但**只适合党务**；「其他诉求」不应投这里 |
| 基建管理中心 | `ocpd@shanghaitech.edu.cn` | 仅英文页 <https://www.shanghaitech.edu.cn/en/administrative/list.htm> | 中文页给的是个人邮箱 `zhaojch@`，两者不一致 |
| 上道/科道/大道书院 | `shangdaocollege@` / `kedao@` / `dadao.college@` | 迎新《书院介绍》PDF：<https://fresh.shanghaitech.edu.cn/2026/0720/c1890a1125551/page.htm> | 单份 PDF，但属官方正文；仅适合书院事务 |

> 注：`life@`、`share@`、`clinic@` 等虽然只在一两页出现，但属官网正文且语义明确，上文已按「已确认/辅助」处理。

---

## 3. 未找到

| 对象 | 我试过哪些站点/入口 | 结果 |
| --- | --- | --- |
| **食堂/餐饮专属邮箱** | 迎新网 19 页 + 7 份 PDF；主站「联系我们」「机构设置」；公共服务处中英文页；信息公开「后勤保障」栏目 <https://openinfo.shanghaitech.edu.cn/47/list.htm> | **没有** `canteen@` / `hq@` / `logistics@`。只有公共服务处总邮箱 `ogs@` |
| **宿舍/公寓专属邮箱** | 迎新《生活手册》；学生事务处 100+ 页（爬虫遍历上限 120）；信息公开「学生事务管理」<https://openinfo.shanghaitech.edu.cn/40/list.htm> | **没有** `dorm@` / `housing@`。只有各公寓楼 24h 电话 20685501–20685510 和学生事务处总邮箱 |
| **报修/物业专属邮箱** | 公共服务处页面、校园服务中心信息、生活手册 | **没有**。报修走校园服务中心/电话，公开渠道无邮箱 |
| **校长信箱 / 校长办公室专属邮箱** | 主站、信息公开「依申请公开」、英文页 | 信息公开受理部门写的是「校长办公室」，但公布邮箱是 `openinfo@shanghaitech.edu.cn`（仅信息公开业务），**没有**独立校长信箱 |
| **教务处独立域名 `jwc.`** | `jwc.shanghaitech.edu.cn` | **NXDOMAIN**（DoH 明确不存在；curl 000）。教务处实际在 `oaa.shanghaitech.edu.cn` |
| **后勤独立域名 `hq.`** | `hq.shanghaitech.edu.cn` | **NXDOMAIN**（curl 000） |
| **信息化独立域名 `itc.`** | `itc.shanghaitech.edu.cn` | **NXDOMAIN**（curl 000） |
| **学生处独立域名 `student.`** | `student.shanghaitech.edu.cn` | **NXDOMAIN**（curl 000） |
| **猜测地址 `logistics@` / `academics@`** | 全站文本、英文页、PDF | **没有任何页面公布过**。不要使用；`academics@` 尤其危险，真实教务处用的是 `student@` |

> `robots.txt` 与 `sitemap.xml` 都返回 **HTTP 200 但 0 字节**，没有可用站点地图。

---

## 4. 对中国高校部门邮箱命名的观察

1. **角色别名（role@）是主流**：`office@` `student@` `studentaffairs@` `ogs@` `facility@` `library@` `hr@` `finance@` `research@` `admission@` `gadmission@` `oia@` `ott@` `ehs@` `citl@`。这类地址换人不受影响，是给外部用的。
2. **个人地址是「拼音 + 数字」**：`yange1@` `zhangyf4@` `chenjj3@` `luyj2@` `xiongbing@` `zhaojch@` `chengmin@`。数字用于重名区分，**不是学号**。这类地址一旦人员离职就失效。
3. **没有「学号@」式地址**。学生邮箱是统一域下按姓名分配的，不是 `2026xxxx@`。
4. **最容易猜错的两处**：
   - `student@` 属于**教务处**，不是学生事务处；学生事务处是 `studentaffairs@`。
   - `facility@` 属于**设备与资产处**（管采购/资产），**不是**修宿舍/修路灯的后勤。
5. **同一部门可能有多个别名**：IT 有服务台 `it-support@` 和部门总号 `it@`；公共服务处中文/英文电话还不一致。**别名越多，越不能靠猜**。
6. **书院/学院喜欢用全名或缩写**：`shangdaocollege@` `kedao@` `dadao.college@`（允许带点）、`sist@` `spst@` `slst@` `bme@`。这类通常只在迎新/学院页出现，主站「联系我们」不一定收全。
7. **通用别名会被多个部门共用**：英文页把 `student@` 同时挂在「教务处」和「学生事务处」名下，说明官网维护也有滞后。对众筹诉求这种「发错比不发更糟」的场景，**必须保留人工确认入口**。

---

## 5. 给 `petitions.ts` 的建议取值

### 5.1 逐类建议

| 类别 | 建议 `name` | 建议 `email` | 建议 `phone` | 置信度 | 依据 |
| --- | --- | --- | --- | --- | --- |
| `canteen` 食堂餐饮 | **公共服务处** | **`ogs@shanghaitech.edu.cn`** | 86-21-20684567 | **中高** | OGS 职责明确含「餐饮住宿」；邮箱 3 页可查。但它是**部门总邮箱，不是食堂专线**，建议 UI 注明「餐饮问题请说明具体食堂/档口」 |
| `facility` 公共设施/维修 | **公共服务处** | **`ogs@shanghaitech.edu.cn`** | 86-21-20684567 | **中** | OGS 管「楼宇物业、能源中心、体育设施、环境绿化」。**不要用 `facility@`**——那是设备与资产处，管采购/资产，不管修东西 |
| `teaching` 教学教务 | **教务处** | **`student@shanghaitech.edu.cn`** | 86-21-20685313 | **高** | 中文「联系我们」+ 教务处自己的「联系我们」图片 OCR + 英文页三处一致；反直觉但真实 |
| `dorm` 宿舍生活 | **学生事务处** | **`studentaffairs@shanghaitech.edu.cn`** | 86-21-20685643 | **中高** | 官网正文公布；电话与人员表（闫格，学生事务）一致。住宿分配/退宿在学生事务处，报修在 OGS |
| `it` 校园信息化 | **图书信息中心（信息化服务）** | **`it-support@shanghaitech.edu.cn`** | **86-21-20685566** | **高** | IT 站「联系我们」+ 首页 + 迎新《生活手册》PDF 三处；是服务台工单邮箱。备选 `it@`（仅英文页） |
| `other` 其他 | **综合办公室（行政）** | **`office@shanghaitech.edu.cn`** | 86-21-20685160 | **高** | 中文「联系我们」+ 英文 University Office。**不要用 `ucoffice@`（党务）**，也不要用 `openinfo@`（仅信息公开申请） |

### 5.2 与当前代码的差异（供你改 `petitions.ts` 时对照）

| 当前值 | 问题 | 建议 |
| --- | --- | --- |
| `canteen.email = facility@`，`emailConfirmed: false` | 设备与资产处不受理食堂；且现在已找到 OGS | 改为 `ogs@`，`emailConfirmed: true`，source 写 `https://www.shanghaitech.edu.cn/1003/list.htm` |
| `facility.name = 设备与资产处`，`facility@` | 类别语义是「公共设施」而非「设备采购」 | 改为「公共服务处 / `ogs@`」；若产品定义确实是「设备资产」才保留 `facility@` |
| `teaching` `student@` | 值正确 | 保留；可把 source 补上 oaa 的 OCR 页 |
| `dorm` `studentaffairs@`，`emailConfirmed: true` | 邮箱只 1 页，标 true 略乐观 | 保留但建议 UI 加「如无回复请拨 20685643」 |
| `it.phone = 86-21-20685191` | 这是**图书馆**电话，不是 IT | 改为 86-21-20685566 |
| `other` `ucoffice@`（党务） | 党务办公室不是校务/校长办公室 | 改为 `office@` + 20685160 |

### 5.3 找不到「专属邮箱」时 UI 怎么显示

这是本次最重要的产品结论：

- **食堂、宿舍、报修都没有「专属邮箱」**，只有主管部门总邮箱。可以投 `ogs@` / `studentaffairs@`，但**不能宣称这是专线**。
- 如果产品必须保证「发出去有人接」，建议 UI 显示：

  > 该校未公布食堂/宿舍的专属收件邮箱。下面是主管部门总邮箱与电话，
  > **发送前请自行确认收件人**；急事请直接拨打 86-21-20684567（公共服务处）。

- **绝对不要**为了「看起来完整」而硬编码 `logistics@`、`academics@`、`dorm@`、`canteen@`。这些地址没有任何官网出处，退信/进垃圾邮件的概率极高。
- 电话同样是有效交付物：`20685643`（学生事务处）、`20684567`（公共服务处）、`20685566`（IT 服务台）都比一个没人看的邮箱更可靠。

---

## 6. 附录

### 6.1 实际访问记录（HTTP 状态码）

| URL | HTTP | 大小 | 说明 |
| --- | --- | --- | --- |
| <https://fresh.shanghaitech.edu.cn/> | 200 | 5,042 B | 迎新网首页；正文大量内嵌 PDF |
| <https://www.shanghaitech.edu.cn/> | 200 | 65,644 B | 主站首页 |
| <https://www.shanghaitech.edu.cn/jgsz/list.htm> | 200 | 65,203 B | 机构设置（有部门职责，无邮箱） |
| <https://www.shanghaitech.edu.cn/1488/list.htm> | 200 | 66,738 B | **联系我们**，32 个部门邮箱+电话 |
| <https://www.shanghaitech.edu.cn/1003/list.htm> | 200 | 66,738 B | 同上（另一个入口） |
| <https://www.shanghaitech.edu.cn/en/administrative/list.htm> | 200 | 292,161 B | 英文版行政部门表，含 `it@` `ocpd@` `office@` 等 |
| <https://www.shanghaitech.edu.cn/en/1059/list.htm> | 200 | 30,971 B | 英文 Contact Us（仅 `oia@`） |
| <https://www.shanghaitech.edu.cn/en/2018/0130/c1765a14719/page.htm> | 200 | — | OGS 英文页：`ogs@` + 20685167 |
| <https://www.shanghaitech.edu.cn/en/2018/0126/c1765a14161/page.htm> | 200 | — | Student Affairs 英文页：`student@` + 20685136 |
| <https://it.shanghaitech.edu.cn/> | 200 | 59,803 B | 信息化服务首页：`it-support@` + 20685566 |
| <https://it.shanghaitech.edu.cn/lxwm/list.htm> | 200 | 23,721 B | IT「联系我们」 |
| <https://it.shanghaitech.edu.cn/7957/list.htm> | 200 | — | IT 团队分工（个人邮箱+分机） |
| <https://oaa.shanghaitech.edu.cn/> | 200 | 46,995 B | 教务处/研究生院门户 |
| <https://oaa.shanghaitech.edu.cn/4074/list.htm> | 200 | 21,582 B | 教务处「联系我们」栏目（两条图文） |
| <https://oaa.shanghaitech.edu.cn/2018/1015/c4074a34510/page.htm> | 200 | 22,351 B | 教务处工作人员图（OCR 出 `student@`） |
| <https://oaa.shanghaitech.edu.cn/2022/1102/c4074a952049/page.htm> | 200 | 29,886 B | 研究生院联系方式（`gadmission@`） |
| <https://xsc.shanghaitech.edu.cn/> | 200 | 51,504 B | 学生事务处官网 |
| <https://xsc.shanghaitech.edu.cn/ryjs/list.htm> | 200 | 27,543 B | 人员介绍：姓名/职责/邮箱前缀/电话（含闫格 20685643） |
| <https://openinfo.shanghaitech.edu.cn/> | 200 | 42,089 B | 信息公开网 |
| <https://openinfo.shanghaitech.edu.cn/15/list.htm> | 200 | 42,484 B | 依申请公开：校长办公室、`openinfo@`、20685158 |
| <https://openinfo.shanghaitech.edu.cn/47/list.htm> | 200 | — | 后勤保障栏目（餐饮/公寓制度，无邮箱） |
| <https://life.shanghaitech.edu.cn/> | 200 | 26,150 B | 书院生活 |
| <https://life.shanghaitech.edu.cn/xlzx/list.htm> | 200 | — | 心理咨询：`share@` + 20685560 |
| <https://library.shanghaitech.edu.cn/> | 200 | 49,222 B | 图书馆：`library@` |
| <https://sist.shanghaitech.edu.cn/> | 200 | 78,202 B | 信息学院（仅作命名规律抽样） |
| <https://siais.shanghaitech.edu.cn/> | 200 | 41,972 B | 免疫化学所（同上） |
| <https://spst.shanghaitech.edu.cn/> | 200 | 48,894 B | 物质学院（同上） |
| <https://slst.shanghaitech.edu.cn/> | 200 | 48,036 B | 生命学院（同上） |
| <https://bme.shanghaitech.edu.cn/> | 200 | 30,725 B | 生物医学工程学院（同上） |
| <https://graduate.shanghaitech.edu.cn/> | 200 | 282 B | 只是 JS 跳转到 `gsapp` 招生系统，无联系方式 |
| <https://www.shanghaitech.edu.cn/robots.txt> | 200 | 0 B | 空文件 |
| <https://www.shanghaitech.edu.cn/sitemap.xml> | 200 | 0 B | 空文件 |
| `https://jwc.shanghaitech.edu.cn/` | **000** | 0 B | **NXDOMAIN**（DoH 确认不存在） |
| `https://hq.shanghaitech.edu.cn/` | **000** | 0 B | **NXDOMAIN** |
| `https://itc.shanghaitech.edu.cn/` | **000** | 0 B | **NXDOMAIN** |
| `https://student.shanghaitech.edu.cn/` | **000** | 0 B | **NXDOMAIN** |
| `logistics.` / `canteen.` / `dorm.shanghaitech.edu.cn` | **000** | — | 均 NXDOMAIN |

> 团队内部说的「fake-ip 198.18.x.x」是 Clash 的映射，不代表域名真实存在；用 DoH 才能区分「被代理挡住」和「根本没有这个域名」。

### 6.2 教务处「联系我们」图片 OCR 结果

来源：<https://oaa.shanghaitech.edu.cn/2018/1015/c4074a34510/page.htm> 内嵌图
`/_upload/article/images/e8/5b/.../41645b70-c81b-4f94-87cc-d7a4172619fe_d.jpg`

```
部门        教务处
办公地点    行政中心 103
工作内容    专业建设、培养方案、教学计划、课程考务和成绩管理等；
            本科课程排课、选课、中期退课等；
            本科生国际交流项目、学分认定、留学深造咨询；
            本科学籍学历、毕业审核、学业预警、毕业论文、助教管理；
            教材管理、教室管理、信息宣传等。
邮箱        student@shanghaitech.edu.cn
```

OCR 只识别出**一个部门公共邮箱**，没有个人邮箱；这与主站「教务处 20685313 `student@`」一致。

### 6.3 本次抓取到的邮箱数量

- 去重后 **84 个邮箱字符串**（含 1 个解析噪声 `1@`，以及 `CITL@`/`citl@` 大小写重复），实际约 **82 个**。
- 其中**部门/角色邮箱约 40 个**，其余是教师/辅导员个人邮箱（`yange1@`、`zhangyf4@` 等）。
- 与六类诉求**直接相关**的候选 **7 个**：`student@`、`studentaffairs@`、`ogs@`、`it-support@`、`office@`、`facility@`、`it@`。
- 其中 **6 个已确认**：`student@`、`ogs@`、`it-support@`、`office@`、`facility@`（这 5 个≥2 页）+ `studentaffairs@`（官网正文单页，电话交叉验证）。`it@` 仅英文页，标「可能」。

### 6.4 没有验证什么

1. **没有发测试邮件**，所以所有地址都只证明「官网这样写」，不证明「现在能收信/有人处理」。
2. **没有验证邮箱归属人**（例如 `office@` 背后是几个人、多久看一次）。
3. **没有打部门电话**核实号码是否仍在使用；电话数字全部来自官网文本。
4. **没有穷尽**所有学院/书院页面（只抽样了 5 个学院 + 书院/心理/图书馆）；与六类无关的科研机构没有逐个抓。
5. **没有验证** `finance@` 的排版错误是否影响收信（与诉求无关）。
6. 英文页与中文页冲突时，本报告**没有替学校裁决**，而是把两个值都列出并给倾向。
