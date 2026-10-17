import { Injectable } from '@nestjs/common';
import type { CampusSession } from '../domain/auth.domain';
import type {
  CampusCardSnapshot,
  CampusCourseDatum,
  CampusDataPort,
  CampusIdentityDatum,
} from '../domain/campus-data.domain';

/**
 * `CampusDataPort` 的**模拟实现**（`CAMPUS_DATA_MODE=mock`，默认）。
 *
 * 为什么需要它：上科大的 EGATE / CPDAILY / JWC / CARD 都只对
 * **官方申请的客户端**开放，仓库里不可能带真实凭据，但我们又不能让
 * 「身份 / 课表 / 校园卡」三个模块变成一个永远点不通的空壳 ——
 * 那样连"绑定 → 取数 → 解绑"这条链路是否正确都无法验证。
 *
 * 因此这里给出**确定性**的模拟数据：
 *   · 同一个 (userId, platform) 永远得到同一份数据 → 页面不会"每次刷新都变"，可回归测试；
 *   · 结构、字段、边界（余额、脱敏、时间戳）与真实上游一致；
 *   · 响应里始终带 `simulated: true`，UI 必须标注，绝不冒充真实数据。
 *
 * 换成真实上游只需把 `CAMPUS_DATA_MODE` 切成 `live` 并配置 DATA_URL，本文件可原地弃用。
 */

/** FNV-1a：把 (userId, platform, 业务) 稳定映射成一个 32 位无符号整数 */
function hashOf(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function pick<T>(list: readonly T[], seed: number): T {
  return list[seed % list.length] as T;
}

const SURNAMES = ['黄', '沈', '陆', '苏', '顾', '何', '许', '秦'] as const;
const GIVEN_NAMES = ['一鸣', '思远', '子墨', '亦航', '知微', '雨桐', '若谷', '怀瑾'] as const;
const DEPARTMENTS = [
  '信息科学与技术学院',
  '生命科学与技术学院',
  '物质科学与技术学院',
  '生物医学工程学院',
  '数学科学研究所',
] as const;
const CAMPUSES = ['张江', '岳阳路'] as const;

/** 课程池。slot 组合**互不冲突**，保证开箱即用的数据是"干净"的 */
const COURSE_POOL: readonly CampusCourseDatum[] = [
  { courseName: '数据结构与算法', teacher: '陆明', location: '信息楼 305', weekday: 1, startSlot: 1, endSlot: 2, weeks: '1-16 周' },
  { courseName: '线性代数', teacher: '许岚', location: '教学中心 201', weekday: 1, startSlot: 3, endSlot: 4, weeks: '1-16 周' },
  { courseName: '机器学习导论', teacher: '沈亦航', location: '信息楼 401', weekday: 2, startSlot: 5, endSlot: 6, weeks: '1-16 周' },
  { courseName: '普通物理学', teacher: '顾远', location: '物质楼 B102', weekday: 2, startSlot: 1, endSlot: 2, weeks: '1-16 周' },
  { courseName: '计算机系统基础', teacher: '何知微', location: '信息楼 203', weekday: 3, startSlot: 3, endSlot: 4, weeks: '1-16 周' },
  { courseName: '英语学术写作', teacher: '苏若谷', location: '教学中心 408', weekday: 3, startSlot: 7, endSlot: 8, weeks: '1-16 周' },
  { courseName: '概率论与数理统计', teacher: '秦怀瑾', location: '教学中心 305', weekday: 4, startSlot: 1, endSlot: 2, weeks: '1-16 周' },
  { courseName: '操作系统', teacher: '黄一鸣', location: '信息楼 306', weekday: 4, startSlot: 5, endSlot: 6, weeks: '1-16 周' },
  { courseName: '生物化学实验', teacher: '陆思远', location: '生命楼 L305', weekday: 5, startSlot: 3, endSlot: 5, weeks: '1-16 周' },
  { courseName: '体育（羽毛球）', teacher: '许子墨', location: '体育馆 2 号场', weekday: 5, startSlot: 7, endSlot: 8, weeks: '1-16 周' },
  { courseName: '数字电路', teacher: '沈雨桐', location: '信息楼 108', weekday: 2, startSlot: 7, endSlot: 8, weeks: '1-16 周' },
  { courseName: '创新创业实践', teacher: '顾怀瑾', location: '创管中心 101', weekday: 3, startSlot: 9, endSlot: 10, weeks: '1-16 周' },
] as const;

const MERCHANTS: readonly { merchant: string; minFen: number; maxFen: number }[] = [
  { merchant: '第一食堂 · 二楼', minFen: 800, maxFen: 2600 },
  { merchant: '第三食堂 · 面档', minFen: 600, maxFen: 1800 },
  { merchant: '教学楼自助咖啡', minFen: 900, maxFen: 1800 },
  { merchant: '图书馆打印中心', minFen: 100, maxFen: 900 },
  { merchant: '宿舍洗衣房', minFen: 300, maxFen: 600 },
  { merchant: '校园超市', minFen: 500, maxFen: 4200 },
] as const;

@Injectable()
export class MockCampusDataAdapter implements CampusDataPort {
  readonly mode = 'mock' as const;

  async fetchIdentity(session: CampusSession): Promise<CampusIdentityDatum> {
    const seed = hashOf(`${session.sessionRef}:identity`);
    const studentId = `20${24 + (seed % 3)}${String(seed % 100000).padStart(5, '0')}`;
    const surname = pick(SURNAMES, seed);
    const given = pick(GIVEN_NAMES, seed >> 3);

    return {
      studentId,
      realName: `${surname}${given}`,
      department: pick(DEPARTMENTS, seed >> 5),
      email: `${studentId}@shanghaitech.edu.cn`,
      campus: pick(CAMPUSES, seed >> 7),
    };
  }

  async fetchSchedule(session: CampusSession, term: string): Promise<CampusCourseDatum[]> {
    const seed = hashOf(`${session.sessionRef}:schedule:${term}`);
    // 取 7 门课（池子里 slot 互不冲突），再按学期做一次平移，使不同学期不完全一样
    const shift = seed % COURSE_POOL.length;
    const rotated = [...COURSE_POOL.slice(shift), ...COURSE_POOL.slice(0, shift)];
    return rotated.slice(0, 7).map((course) => ({ ...course }));
  }

  async fetchCard(session: CampusSession): Promise<CampusCardSnapshot> {
    const seed = hashOf(`${session.sessionRef}:card`);
    const balanceFen = 3000 + (seed % 22000);
    const count = 12 + (seed % 5);
    const transactions: CampusCardSnapshot['transactions'] = [];

    // 从当前余额**往回推**每一笔的余额快照，保证流水与余额自洽
    let running = balanceFen;
    const now = Date.now();
    for (let i = 0; i < count; i += 1) {
      const entrySeed = hashOf(`${session.sessionRef}:card:${i}`);
      const template = pick(MERCHANTS, entrySeed);
      const amountFen = template.minFen + (entrySeed % (template.maxFen - template.minFen + 1));
      const isTopUp = i === count - 1; // 最后一笔当作"充值"，让流水两头都有
      const direction: 'in' | 'out' = isTopUp ? 'in' : 'out';

      if (direction === 'out') {
        transactions.push({
          amountFen,
          direction,
          merchant: template.merchant,
          happenedAt: new Date(now - (i + 1) * 7 * 3600 * 1000 - (entrySeed % 3600) * 1000),
          balanceAfterFen: running,
        });
        running += amountFen; // 反向累加：这笔之前余额更高
      } else {
        // 充值笔：金额 200 元，且保证"充值前余额"不会为负
        const topUp = 20000;
        const before = Math.max(0, running - topUp);
        transactions.push({
          amountFen: topUp,
          direction,
          merchant: '校园卡充值 · 微信支付',
          happenedAt: new Date(now - (i + 1) * 26 * 3600 * 1000),
          balanceAfterFen: running,
        });
        running = before;
      }
    }

    return { balanceFen, transactions, dataAsOf: new Date(now) };
  }
}
