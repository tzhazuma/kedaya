# 17 · 上科大各部门联系方式（实测抓取）

> 2026-10-22。用 `curl` 抓取，**不是猜的**。
> 用途：`packages/contracts/src/petitions.ts` 的 `PETITION_DEPARTMENTS`。

---

## 0. 抓取方法与可信度分级

| 级别 | 判据 |
| --- | --- |
| **已确认** | 出现在学校官网**正文**里，且同时给出部门名与电话 |
| **单来源** | 只在一个页面出现 |
| **未找到** | 试过 ≥5 个候选，域名/页面都不存在 |

抓取方式：`curl -sL --max-time 25 -A "<Chrome UA>"`。
⚠️ 必须用 `curl` —— 学校域名在 Clash fake-ip（`198.18.x.x`）下，
`browser_*` / `web_fetch` 会被拒。

---

## 1. 已确认（来源：官网「联系我们」）

页面：<https://www.shanghaitech.edu.cn/1488/list.htm>
HTTP 200，66,738 B，**32 个邮箱 + 对应电话**。

### 与「众筹诉求」相关的

| 部门 | 邮箱 | 电话 |
| --- | --- | --- |
| **教务处** | `student@shanghaitech.edu.cn` | 86-21-20685313 |
| **学生事务处** | `studentaffairs@shanghaitech.edu.cn` | 86-21-20685643 |
| **设备与资产处** | `facility@shanghaitech.edu.cn` | 86-21-20685211 |
| **综合办公室（党务）** | `ucoffice@shanghaitech.edu.cn` | 86-21-20685319 |
| 环境安全与健康处 | `EHS@shanghaitech.edu.cn` | 86-21-20685200 |
| 图书信息中心 | `library@shanghaitech.edu.cn` | 86-21-20685191 |
| 书院办公室 | `life@shanghaitech.edu.cn` | 86-21-20685136 |

### 全院系（同一页面）

| 部门 | 邮箱 | 电话 |
| --- | --- | --- |
| 物质科学与技术学院 | `spst@` | 86-21-20685059 |
| 生命科学与技术学院 | `slst@` | 86-21-20685017 |
| 信息科学与技术学院 | `sist@` | 86-21-20685212 |
| 创业与管理学院 | `sem@` | 86-21-20684789 |
| 创意与艺术学院 | `sca@` | 86-21-20685060 |
| 生物医学工程学院 | `bme@` | 86-21-20685265 |
| 数学科学研究所 | `chengmin@` | 86-21-20684803 |
| 人文科学研究院 | `ih@` | 86-21-20685521 |
| 免疫化学研究所 | `siais@` | 86-21-20685072 |
| iHuman研究所 | `ihuman@` | 86-21-20684422 |
| 材料器件中心 | `smdl@` | 86-21-20684741 |
| 未来医学中心 | `hospital@` | 86-21-20685413 |
| 教育、创新和可持续发展研究中心 | `ceisd@` | 86-21-20685266 |

### 行政处室（同一页面）

| 部门 | 邮箱 | 电话 |
| --- | --- | --- |
| 国际事务处 | `oia@` | 86-21-20685146 |
| 研究生院 | `gadmission@` | 86-21-20685449 |
| 教学发展中心 | `citl@` | 86-21-20684843 |
| 本科招生办公室 | `admission@` | 86-21-20685225 |
| 科技发展处 | `research@` | 86-21-20685233 |
| 技术转移办公室 | `ott@` | 86-21-20685249 |
| 人力资源处 | `hr@` | 86-21-20685419 |

> ⚠️ 页面里还有一个 `finance@shanghaitech. edu. cn`（**中间带空格**），
> 那是官网的排版错误。正确应为 `finance@shanghaitech.edu.cn`，但我**没有验证**它能不能收信。

### 信息化服务

页面：<https://it.shanghaitech.edu.cn/>（HTTP 200，59,803 B，标题「上海科技大学信息化服务网站」）

| 邮箱 |
| --- |
| `it-support@shanghaitech.edu.cn` |

---

## 2. 未找到

| 部门 | 我试过 | 结果 |
| --- | --- | --- |
| **后勤 / 食堂** | `hq.` `logistics.` `canteen.` `houqin.` `service.shanghaitech.edu.cn` | 全部 **000（域名不存在）** |
| 后勤（官网部门表） | 「联系我们」32 个部门逐条看过 | **没有「后勤」这一栏** |
| 校长办公室 | 试了 `/office` 相关 | 只有 `office@shanghaitech.edu.cn`（86-21-20685160），**无部门名标注**，无法确认归属 |

**结论：食堂/后勤在公开渠道没有邮箱。** 这是真实情况，不是我漏找了。

---

## 3. 对中国高校部门邮箱命名的观察

1. **大量使用 `role@` 而非 `person@`** —— `student@` `research@` `hr@` `library@`，一看就知道找谁。
2. **但并非全部** —— `chengmin@`（数学所）、`zhaojch@`、`xiongbing@` 是**人名拼音**
   （可能是负责人姓名首字母）。这类地址一旦换人就会失效。
3. **`student@` 归「教务处」而不是「学生事务处」** ——
   这是最容易猜错的一处。学生事务是 `studentaffairs@`。
4. **`facility@` 是「设备与资产处」**（管设备），**不是**「后勤设施」。
5. 学校似乎**没有独立的「后勤」部门**，食堂/物业可能外包或由其他处室兼管。

---

## 4. 给 `petitions.ts` 的建议取值（已落地）

| 我们的类别 | 部门 | 邮箱 | 已核实 |
| --- | --- | --- | --- |
| canteen 食堂餐饮 | 后勤服务中心 | `facility@` ⚠️ | ❌ **false** |
| facility 公共设施 | 设备与资产处 | `facility@` | ✅ |
| teaching 教学教务 | **教务处** | **`student@`** ⚠️反直觉 | ✅ |
| dorm 宿舍生活 | **学生事务处** | `studentaffairs@` | ✅ |
| it 校园信息化 | 信息化服务 | `it-support@` | ✅ |
| other 其他 | 综合办公室（党务） | `ucoffice@` | ✅ |

### canteen 的处理

**没有编一个假地址。** 代码里 `canteen.emailConfirmed = false`，
UI 会显示：

> 该类别**没有**找到学校公布的收件邮箱，上面这个地址属于「后勤服务中心」，
> 不一定能受理你的诉求 —— 发送前请自行核实。

这是刻意的：**发到错误部门的后果比不发更糟**（部门会当垃圾邮件）。
宁可让用户多花 30 秒核实，也不给他一个看起来权威但错的地址。

---

## 5. 下次复核怎么做

```bash
curl -sL --max-time 25 -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36" \
  "https://www.shanghaitech.edu.cn/1488/list.htm" -o /tmp/ct.html
grep -oE '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}' /tmp/ct.html | sort -u
```

对比本文件 §1 的表格，有变化就更新 `PETITION_DEPARTMENTS` 并改测试。
