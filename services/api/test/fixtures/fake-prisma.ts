/**
 * wildlife 测试夹具：**内存版 Prisma**。
 *
 * 本机没有 PostgreSQL（任务书明确"无 PostgreSQL，用离线证据"），
 * 但 HTTP 端到端验收又必须走**真实**的控制器/守卫/拦截器/仓储/视图，
 * 只把持久化换成内存实现 —— 否则"e2e"只是把假数据喂给假服务，什么都证明不了。
 *
 * 支持的 Prisma 子集（只覆盖 wildlife 实际用到的部分）：
 *   where（等值 / in / not / notIn / gte / lte / lt / gt / equals / null / OR / AND）
 *   orderBy（单键或数组）、take、cursor+skip、distinct、select
 *   findMany / findFirst / findUnique / create / createMany / update / updateMany
 *   / delete / deleteMany / count / upsert
 *
 * 刻意**不支持** include/关联查询：wildlife 的仓储不做 include，
 * 支持它只会让这个夹具偏离被测代码的真实用法。
 */

type Row = Record<string, any>;
type Where = Record<string, any>;

const QUERY_OPERATORS = new Set([
  'in',
  'notIn',
  'not',
  'equals',
  'gte',
  'lte',
  'lt',
  'gt',
  'contains',
  'startsWith',
  'endsWith',
  'mode',
]);

/** 这个嵌套对象是"查询算子"，还是 Prisma 的复合唯一键？ */
function hasQueryOperator(cond: Record<string, unknown>): boolean {
  return Object.keys(cond).some((key) => QUERY_OPERATORS.has(key));
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

function matchesCondition(value: unknown, cond: unknown): boolean {
  if (cond === null) return value === null || value === undefined;
  if (cond instanceof Date) {
    return value instanceof Date ? value.getTime() === cond.getTime() : value === cond;
  }
  if (isPlainObject(cond)) {
    if ('in' in cond && !(cond.in as unknown[]).includes(value)) return false;
    if ('notIn' in cond && (cond.notIn as unknown[]).includes(value)) return false;
    if ('not' in cond) {
      const not = cond.not;
      if (not === null) {
        if (value === null || value === undefined) return false;
      } else if (isPlainObject(not) && 'in' in not) {
        if ((not.in as unknown[]).includes(value)) return false;
      } else if (value === not) {
        return false;
      }
    }
    if ('equals' in cond && value !== cond.equals) return false;
    if ('gte' in cond && !((value as number) >= (cond.gte as number))) return false;
    if ('lte' in cond && !((value as number) <= (cond.lte as number))) return false;
    if ('lt' in cond && !((value as number) < (cond.lt as number))) return false;
    if ('gt' in cond && !((value as number) > (cond.gt as number))) return false;

    return true;
  }
  if (value instanceof Date && typeof cond === 'string') return value.toISOString() === cond;
  return value === cond;
}

export function matchesWhere(row: Row, where: Where | undefined): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'OR') {
      if (!(cond as Where[]).some((sub) => matchesWhere(row, sub))) return false;
      continue;
    }
    if (key === 'AND') {
      if (!(cond as Where[]).every((sub) => matchesWhere(row, sub))) return false;
      continue;
    }
    if (key === 'NOT') {
      if (matchesWhere(row, cond as Where)) return false;
      continue;
    }
    // Prisma 的**复合唯一键**写法：`{ userId_provider: { userId, provider } }`。
    // 行里没有 `userId_provider` 这个字段，所以要把它摊平成若干等值条件。
    // （不加这一条的话，未知的嵌套对象会被 `matchesCondition` 一律视为匹配，
    //  于是 `findUnique({where:{userId_provider:{...}}})` 会**返回第一行** ——
    //  那是最糟的假阳性：越权读在测试里"通过"了。）
    if (isPlainObject(cond) && row[key] === undefined && !hasQueryOperator(cond)) {
      let matched = true;
      for (const [subKey, subCond] of Object.entries(cond as Where)) {
        if (!matchesCondition(row[subKey], subCond)) {
          matched = false;
          break;
        }
      }
      if (!matched) return false;
      continue;
    }
    if (!matchesCondition(row[key], cond)) return false;
  }
  return true;
}

function applyOrderBy(rows: Row[], orderBy: unknown): Row[] {
  if (!orderBy) return rows;
  const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...rows].sort((a, b) => {
    for (const clause of clauses as Array<Record<string, 'asc' | 'desc'>>) {
      for (const [field, direction] of Object.entries(clause)) {
        const av = a[field];
        const bv = b[field];
        if (av === bv) continue;
        const cmp = av instanceof Date && bv instanceof Date ? av.getTime() - bv.getTime() : av > bv ? 1 : -1;
        return direction === 'desc' ? -cmp : cmp;
      }
    }
    return 0;
  });
}

function project(row: Row, select: unknown): Row {
  if (!select || !isPlainObject(select)) return { ...row };
  const out: Row = {};
  for (const key of Object.keys(select)) out[key] = row[key];
  return out;
}

export interface InMemoryDelegate {
  readonly rows: Row[];
  findMany(args?: any): Promise<Row[]>;
  findFirst(args?: any): Promise<Row | null>;
  findUnique(args?: any): Promise<Row | null>;
  create(args?: any): Promise<Row>;
  createMany(args?: any): Promise<{ count: number }>;
  update(args?: any): Promise<Row>;
  updateMany(args?: any): Promise<{ count: number }>;
  delete(args?: any): Promise<Row>;
  deleteMany(args?: any): Promise<{ count: number }>;
  count(args?: any): Promise<number>;
  upsert(args?: any): Promise<Row>;
}

let idCounter = 0;

/** 造一个内存 delegate；`seed` 是初始行 */
export function createInMemoryDelegate(seed: Row[] = [], name = 'row'): InMemoryDelegate {
  const rows: Row[] = [...seed];

  const withDefaults = (data: Row): Row => ({
    id: data.id ?? `${name}-${(idCounter += 1).toString().padStart(4, '0')}`,
    createdAt: data.createdAt ?? new Date(),
    updatedAt: data.updatedAt ?? new Date(),
    ...data,
  });

  return {
    rows,
    async findMany(args: any = {}) {
      let result = rows.filter((row) => matchesWhere(row, args.where));
      result = applyOrderBy(result, args.orderBy);
      if (args.cursor?.id) {
        const index = result.findIndex((row) => row.id === args.cursor.id);
        if (index >= 0) result = result.slice(index + (args.skip ?? 1));
      }
      if (typeof args.take === 'number') result = result.slice(0, args.take);
      if (args.distinct) {
        const fields = args.distinct as string[];
        const seen = new Set<string>();
        result = result.filter((row) => {
          const key = fields.map((f) => String(row[f])).join('|');
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
      return result.map((row) => project(row, args.select));
    },
    async findFirst(args: any = {}) {
      const found = rows.filter((row) => matchesWhere(row, args.where));
      const ordered = applyOrderBy(found, args.orderBy);
      return ordered[0] ? project(ordered[0], args.select) : null;
    },
    async findUnique(args: any = {}) {
      const row = rows.find((candidate) => matchesWhere(candidate, args.where));
      return row ? project(row, args.select) : null;
    },
    async create(args: any = {}) {
      const row = withDefaults(args.data ?? {});
      rows.push(row);
      return { ...row };
    },
    async createMany(args: any = {}) {
      const data = Array.isArray(args.data) ? args.data : [args.data];
      for (const item of data) rows.push(withDefaults(item));
      return { count: data.length };
    },
    async update(args: any = {}) {
      const index = rows.findIndex((row) => matchesWhere(row, args.where));
      if (index < 0) throw Object.assign(new Error('P2025 record not found'), { code: 'P2025' });
      rows[index] = { ...rows[index], ...args.data, updatedAt: new Date() };
      return { ...rows[index]! };
    },
    async updateMany(args: any = {}) {
      let count = 0;
      for (let i = 0; i < rows.length; i += 1) {
        if (matchesWhere(rows[i]!, args.where)) {
          rows[i] = { ...rows[i], ...args.data, updatedAt: new Date() };
          count += 1;
        }
      }
      return { count };
    },
    async delete(args: any = {}) {
      const index = rows.findIndex((row) => matchesWhere(row, args.where));
      if (index < 0) throw Object.assign(new Error('P2025 record not found'), { code: 'P2025' });
      const [removed] = rows.splice(index, 1);
      return { ...removed! };
    },
    async deleteMany(args: any = {}) {
      const keep: Row[] = [];
      let count = 0;
      for (const row of rows) {
        if (matchesWhere(row, args.where)) count += 1;
        else keep.push(row);
      }
      rows.length = 0;
      rows.push(...keep);
      return { count };
    },
    async count(args: any = {}) {
      return rows.filter((row) => matchesWhere(row, args.where)).length;
    },
    async upsert(args: any = {}) {
      const index = rows.findIndex((row) => matchesWhere(row, args.where));
      if (index >= 0) {
        rows[index] = { ...rows[index], ...args.update, updatedAt: new Date() };
        return { ...rows[index]! };
      }
      const row = withDefaults(args.create ?? {});
      rows.push(row);
      return { ...row };
    },
  };
}

/**
 * 假 PrismaService 的形状。
 *
 * 刻意**显式列出每个 delegate**（而不是 `Record<string, InMemoryDelegate>`）：
 * 这样测试里写 `prisma.wildlifeSighting.rows` 才有类型，拼错表名会在
 * `npm run typecheck` 阶段就报错，而不是运行时 undefined。
 */
export interface FakePrisma {
  speciesTaxonomy: InMemoryDelegate;
  wildlifeZone: InMemoryDelegate;
  wildlifeSighting: InMemoryDelegate;
  wildlifeSightingExact: InMemoryDelegate;
  wildlifeMedia: InMemoryDelegate;
  wildlifeSpot: InMemoryDelegate;
  wildlifeTrack: InMemoryDelegate;
  wildlifeIndividual: InMemoryDelegate;
  notification: InMemoryDelegate;
  auditLog: InMemoryDelegate;
  consent: InMemoryDelegate;
  $transaction: (ops: Array<Promise<unknown>>) => Promise<unknown[]>;
  /** 测试用：清空所有表 */
  $reset: () => void;
  /** 测试用：直接塞一行（绕过校验，用于构造场景） */
  $seed: (name: keyof Omit<FakePrisma, '$transaction' | '$reset' | '$seed'>, row: Row) => void;
}

/** 造一个完整的假 PrismaService（含 `$transaction`） */
export function createFakePrisma(seed: Record<string, Row[]> = {}): FakePrisma {
  const make = (name: string): InMemoryDelegate => createInMemoryDelegate(seed[name] ?? [], name);

  const prisma: FakePrisma = {
    speciesTaxonomy: make('speciesTaxonomy'),
    wildlifeZone: make('wildlifeZone'),
    wildlifeSighting: make('wildlifeSighting'),
    wildlifeSightingExact: make('wildlifeSightingExact'),
    wildlifeMedia: make('wildlifeMedia'),
    wildlifeSpot: make('wildlifeSpot'),
    wildlifeTrack: make('wildlifeTrack'),
    wildlifeIndividual: make('wildlifeIndividual'),
    notification: make('notification'),
    auditLog: make('auditLog'),
    consent: make('consent'),
    $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops),
    $reset() {
      for (const value of Object.values(prisma)) {
        if (value && typeof value === 'object' && 'rows' in value) {
          (value as InMemoryDelegate).rows.length = 0;
        }
      }
    },
    $seed(name, row) {
      (prisma[name] as InMemoryDelegate).rows.push(row);
    },
  };

  return prisma;
}
