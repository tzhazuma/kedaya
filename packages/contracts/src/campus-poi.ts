/**
 * 校园地图 POI **补充层** —— 快递站 / 地下车库 / 食堂菜单 / 活动场地 / 自习空间，
 * 以及挂在 POI 上的时间性安排（课 / 活动 / 考试 / 个人日程）。
 *
 * ## 为什么叫「补充层」
 *
 * `apps/web/public/map/campus-poi.json` 已有 **186 个 OSM 要素**
 *（建筑 86 / 水域 14 / 康体 8 / 绿地 38 / 设施 20 / 校门 15 / 轨道 5），
 * 那份快照回答「校园里有什么形状、在哪儿」。本文件不复制、不替代它，
 * 只描述**OSM 没覆盖或需要运营补充**的点位与它们的附加信息：
 * 快递站在哪、车库入口在哪、哪个食堂有菜单展示、哪个空间能自习。
 *
 * ## 照片版权：只收「有署名 + 可撤回」的授权照片
 *
 * `https://map.niyiwei.com`（上科大一图通）是**另一个参赛组**的作品，
 * 不是校方数据源。其中：
 *   · **地下车库照片是他们同学手动拍摄的**；
 *   · **食堂菜单照片是他们拍照采集的**。
 *
 * 这些照片的**著作权归拍摄者**。2026-10-20，项目负责人唐志昊已**口头**获得
 * 对方参赛组授权，允许合并其地库照片与食堂菜单照片；**没有书面文件**。
 * 因此本契约把该域名从「禁止抓取」改为「可引用但必须署名、且可一键撤回」：
 *
 *   1. **不内置任何照片**：清单在 `apps/miniapp/.../campusPoiPhotos.ts`，
 *      只存远程 URL，不把原图打进小程序包（实测 31.41 MiB，主包上限 2 MiB）；
 *   2. `photoUrls` 默认是空数组 —— POI 先建模、后录入，不假装已有图片；
 *   3. `photoUrls` 非空时 **`photoCredit` 必填**（拍摄者 / 授权方署名），由
 *      [validatePoiSupplement] 强制、由测试锁死；多张照片时必须列出**全部**
 *      权利方。**口头授权不改变这一条**：没有署名就拒收；
 *   4. 授权可撤回：`node tools/import-niyiwei-photos.mjs --revoke`
 *      会清空照片清单并关闭开关；本契约的 `forbiddenOrigins` 留空数组 +
 *      校验逻辑，日后对方要求下架时把域名填回去即可再次拦截；
 *   5. **只借照片**：不抓取对方站点的菜品、价格、评论或任何用户数据；
 *   6. 食堂菜单优先走我们已有的 `canteen` 菜品库，不依赖任何菜单照片；
 *   7. 除已获授权的 niyiwei 外，其他第三方站点的照片仍不得抓取；合法来源只有
 *      管理员/用户**自己上传并声明已获授权**，或明确公有领域且留证的素材。
 *
 * 以后谁想「顺手把别组的图扒下来」，先读这段。
 *
 * ## 坐标系：WGS84，且**不要**和 `CAMPUS_BOUNDS` 混用
 *
 * 契约 §2.6 与 `packages/shared/src/geo/gcj02.ts` 头注释都规定
 * **WGS84 是唯一真相**：数据库、API、上传一律 WGS84。
 * `apps/web/public/map/campus-poi.json` 里的 186 个 POI 也是 WGS84。
 *
 * ⚠️ `campus-map.ts` 里的 `CAMPUS_BOUNDS` / `CAMPUS_BOUNDARY` 是 **GCJ-02**
 *（由 BD-09 底图反算而来）。拿它来校验本文件的 WGS84 坐标会**整体偏约 470 米**，
 * 把校园内的点误判成越界。因此本文件单独定义 [CAMPUS_POI_BOUNDS]。
 *
 * ## 空模型与录入闸门
 *
 * [createPoiDraft] 产出「无照片、未核实、来源未知」的草稿；管理员/用户录入时
 * 先补 `photoCredit`（如果带照片），再跑 [validatePoiSupplement]。
 * 这里**故意没有**从 URL 抓图的函数。
 */

/* ------------------------------------------------------------------ *
 * 分类与来源
 * ------------------------------------------------------------------ */

/** 补充层支持的点位分类（冻结；新增分类必须同时补 label / tone / 测试） */
export const CAMPUS_POI_CATEGORIES = [
  'express-station',
  'parking-garage',
  'canteen-menu',
  'event-venue',
  'study-space',
  'other',
] as const;

export type CampusPoiCategory = (typeof CAMPUS_POI_CATEGORIES)[number];

/** 数据来源。`unknown` 是默认值，表示「还没核实」，不是「校方数据」。 */
export const CAMPUS_POI_SOURCES = ['osm', 'official', 'community', 'unknown'] as const;

export type CampusPoiSource = (typeof CAMPUS_POI_SOURCES)[number];

export function isCampusPoiCategory(value: unknown): value is CampusPoiCategory {
  return typeof value === 'string' && (CAMPUS_POI_CATEGORIES as readonly string[]).includes(value);
}

export function isCampusPoiSource(value: unknown): value is CampusPoiSource {
  return typeof value === 'string' && (CAMPUS_POI_SOURCES as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ *
 * 核心类型
 * ------------------------------------------------------------------ */

/**
 * 一条补充 POI。
 *
 * 坐标是 **WGS84**（不是 GCJ-02 / BD-09），与 `campus-poi.json` 一致。
 * 所有字段都是必填的（可以是 `null` / 空数组），避免「有的记录缺字段、
 * 有的记录有字段」导致的渲染分支爆炸。
 */
export interface CampusPoiSupplement {
  /** 稳定 id（建议 `poi-<category>-<slug>`；不要用会随数据库迁移变化的行号） */
  readonly id: string;
  readonly category: CampusPoiCategory;
  readonly name: string;
  /** WGS84 纬度 */
  readonly lat: number;
  /** WGS84 经度 */
  readonly lng: number;
  /** 楼层：地面层用 `0`，地下用负数，未知用 `null` */
  readonly floor: number | null;
  readonly description: string | null;
  /** 开放时间，建议沿用 OSM `opening_hours` 语法；契约不解析它 */
  readonly openingHours: string | null;
  /**
   * 已获授权的照片 URL。
   *
   * ⚠️ **默认必须为空数组**。只有拍摄者本人或已获授权的素材才能进来。
   * `map.niyiwei.com` 已获口头授权（见文件头），**可以**引用，但必须同时填写
   * `photoCredit`；其他第三方站点仍然不得抓取。
   */
  readonly photoUrls: readonly string[];
  /**
   * 拍摄者 / 授权方署名。
   *
   * **`photoUrls` 非空时必填**（版权合规硬要求）。多张照片时列出全部权利方。
   */
  readonly photoCredit: string | null;
  /** 这条记录（位置 / 照片授权 / 营业时间）最近一次核实的时刻；未知为 `null` */
  readonly verifiedAt: string | null;
  readonly source: CampusPoiSource;
}

/**
 * 校园 WGS84 外接矩形。
 *
 * 来源：`apps/web/public/map/campus-poi.json` 的 `campus.bounds`
 *（OSM relation 5390610，与 Nominatim 返回值一致）。
 * 测试会直接读那份 JSON 比对，防止这里悄悄漂移。
 *
 * ⚠️ 它与 `campus-map.ts` 的 `CAMPUS_BOUNDS` **不是同一坐标系**，
 * 后者是 GCJ-02，不能用来校验本文件的坐标。
 */
export const CAMPUS_POI_BOUNDS = {
  south: 31.175546,
  north: 31.1830156,
  west: 121.5844916,
  east: 121.5960882,
} as const;

/** 点是否落在校园 WGS84 外接矩形内（含边界）。非有限值一律 `false`。 */
export function isPoiWithinCampusBounds(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= CAMPUS_POI_BOUNDS.south &&
    lat <= CAMPUS_POI_BOUNDS.north &&
    lng >= CAMPUS_POI_BOUNDS.west &&
    lng <= CAMPUS_POI_BOUNDS.east
  );
}

/**
 * 允许负楼层（地下）的分类白名单。
 *
 * 当前**只允许地下车库**。如果将来确认某个食堂确实在 B1，应当把
 * `canteen-menu` 加进这里并补测试 —— 而不是放宽成「所有分类都允许负数」，
 * 那会让「把车库误标成食堂」这类错误静默通过。
 */
export const CAMPUS_POI_NEGATIVE_FLOOR_CATEGORIES = ['parking-garage'] as const;

const NEGATIVE_FLOOR_CATEGORY_SET: ReadonlySet<string> = new Set(
  CAMPUS_POI_NEGATIVE_FLOOR_CATEGORIES,
);

/* ------------------------------------------------------------------ *
 * 展示语义（只给语义名，不写色值）
 * ------------------------------------------------------------------ */

/** 与 `apps/web` 的 design-tokens 对齐的语义色调；具体色值由渲染层决定 */
export type CampusPoiTone = 'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'danger';

export const CAMPUS_POI_CATEGORY_LABELS: Readonly<Record<CampusPoiCategory, string>> = {
  'express-station': '快递站',
  'parking-garage': '地下车库',
  'canteen-menu': '食堂菜单',
  'event-venue': '活动场地',
  'study-space': '自习空间',
  other: '其他',
};

/**
 * 分类 → 语义色调。
 *
 * **不写死十六进制色值**：Web / 小程序各有一套 design-tokens，
 * 这里只表达「这个点该用哪种语义色」，由渲染层查表。
 */
export const CAMPUS_POI_CATEGORY_TONES: Readonly<Record<CampusPoiCategory, CampusPoiTone>> = {
  'express-station': 'info',
  'parking-garage': 'neutral',
  'canteen-menu': 'warning',
  'event-venue': 'brand',
  'study-space': 'success',
  other: 'neutral',
};

/* ------------------------------------------------------------------ *
 * 照片合规策略（给管理端 / 导入脚本引用，避免各自重新发明规则）
 * ------------------------------------------------------------------ */

/**
 * 照片录入的合规声明。
 *
 * 这是一份**策略常量**，不是授权本身：真正的授权凭证（聊天记录 / 邮件 /
 * 书面许可）仍需由录入方保管。
 *
 * ⚠️ 2026-10-20 变更：`https://map.niyiwei.com` 已从 `forbiddenOrigins` **移出** ——
 * 项目负责人唐志昊已口头获得对方参赛组授权，允许借用其地库照片与食堂菜单照片。
 * 授权是**口头的、可撤回的**，所以：
 *   · 每条照片仍必须有 `photoCredit`（来源方署名），由 [validatePoiSupplement] 强制；
 *   · `photosRevocable` 标记 + `revokeCommand` 提供一键下架；
 *   · `forbiddenOrigins` 保留为空数组（而不是删掉字段）：若对方日后要求下架，
 *     把域名填回来即可在本层重新拦截。
 */
export const CAMPUS_POI_PHOTO_POLICY = {
  /** 有照片就必须有署名（validatePoiSupplement 强制，授权来源也不例外） */
  creditRequired: true,
  /** 允许的录入方式 */
  allowedUploadMethods: ['owner-upload', 'admin-upload-with-authorization', 'public-domain-with-proof'],
  /**
   * 当前**没有**整体禁用的来源。
   *
   * niyiwei 已获口头授权（见上），故不在此列；保留该字段与对应校验，
   * 供授权撤回时把域名填回来即刻生效。
   */
  forbiddenOrigins: [] as readonly string[],
  /** 照片是「借用」的，授权可撤回 */
  photosRevocable: true,
  /** 一条命令清空照片清单并关闭开关（断网可执行） */
  revokeCommand: 'node tools/import-niyiwei-photos.mjs --revoke',
} as const;

/* ------------------------------------------------------------------ *
 * 校验
 * ------------------------------------------------------------------ */

export type CampusPoiIssueCode =
  | 'id-empty'
  | 'name-empty'
  | 'category-unknown'
  | 'coordinate-not-finite'
  | 'coordinate-outside-campus'
  | 'floor-not-integer'
  | 'floor-negative-category'
  | 'source-unknown'
  | 'photo-urls-invalid'
  | 'photo-url-empty'
  | 'photo-url-forbidden-origin'
  | 'photo-credit-required'
  | 'verified-at-invalid';

export interface CampusPoiIssue {
  readonly code: CampusPoiIssueCode;
  readonly field: keyof CampusPoiSupplement | 'coordinates';
  readonly message: string;
}

function issue(
  code: CampusPoiIssueCode,
  field: CampusPoiIssue['field'],
  message: string,
): CampusPoiIssue {
  return { code, field, message };
}

/**
 * 照片 URL 是否指向**明令禁止抓取**的站点（含其子域）。
 *
 * 当前列表为空（niyiwei 已获授权），但保留这段逻辑：授权撤回时把域名填回
 * `forbiddenOrigins` 即可重新拦截。相对路径不受影响。
 *
 * 刻意**不用 `new URL()`**：本契约会被小程序打包运行，而微信小程序的 JS
 * 运行时不保证有完整的 `URL` 全局；用正则解析只依赖字符串能力。
 */
function isForbiddenPhotoUrl(url: string): boolean {
  const host = hostnameOf(url);
  if (host === null) return false;

  return CAMPUS_POI_PHOTO_POLICY.forbiddenOrigins.some((origin) => {
    const forbidden = hostnameOf(origin);
    if (forbidden === null) return false;
    return host === forbidden || host.endsWith(`.${forbidden}`);
  });
}

/** 从绝对 / 协议相对 URL 里取主机名（跳过 userinfo 与端口）；相对路径返回 null */
function hostnameOf(url: string): string | null {
  const match = /^(?:https?:)?\/\/(?:[^/?#@]*@)?([^/?#:]+)(?::\d+)?(?:[/?#]|$)/i.exec(url.trim());
  return match?.[1]?.toLowerCase() ?? null;
}

/**
 * 校验一条补充 POI，返回**全部**问题（空数组 = 通过）。
 *
 * 规则（硬要求）：
 * 1. `id` / `name` / `source` / `category` 必填且合法；
 * 2. `lat` / `lng` 必须是有限值，且落在 [CAMPUS_POI_BOUNDS]（WGS84）内；
 * 3. `floor` 必须是整数；**负数只允许出现在地下车库**；
 * 4. **`photoUrls` 非空时 `photoCredit` 必填** —— 版权合规，测试锁死；
 * 5. 照片 URL 不能是空串、不得指向当前仍在 `forbiddenOrigins` 里的来源；
 *    `verifiedAt` 若存在必须可解析为时间。
 *
 * 注意：本函数只做**单条**校验。id 在集合内是否唯一、同一 POI 是否时间冲突
 * 属于集合级问题，分别由调用方 / [findPoiSlotConflicts] 处理。
 */
export function validatePoiSupplement(poi: CampusPoiSupplement): CampusPoiIssue[] {
  const issues: CampusPoiIssue[] = [];

  if (typeof poi.id !== 'string' || poi.id.trim() === '') {
    issues.push(issue('id-empty', 'id', 'id 不能为空'));
  }

  if (typeof poi.name !== 'string' || poi.name.trim() === '') {
    issues.push(issue('name-empty', 'name', 'name 不能为空'));
  }

  if (!isCampusPoiCategory(poi.category)) {
    issues.push(issue('category-unknown', 'category', `未知分类：${String(poi.category)}`));
  }

  const latFinite = typeof poi.lat === 'number' && Number.isFinite(poi.lat);
  const lngFinite = typeof poi.lng === 'number' && Number.isFinite(poi.lng);

  if (!latFinite) {
    issues.push(issue('coordinate-not-finite', 'lat', 'lat 必须是有限数字'));
  }
  if (!lngFinite) {
    issues.push(issue('coordinate-not-finite', 'lng', 'lng 必须是有限数字'));
  }
  if (latFinite && lngFinite && !isPoiWithinCampusBounds(poi.lat, poi.lng)) {
    issues.push(
      issue(
        'coordinate-outside-campus',
        'coordinates',
        `坐标 (${poi.lat}, ${poi.lng}) 不在校园 WGS84 范围内`,
      ),
    );
  }

  if (poi.floor !== null && !Number.isInteger(poi.floor)) {
    issues.push(issue('floor-not-integer', 'floor', 'floor 必须是整数或 null'));
  } else if (
    typeof poi.floor === 'number' &&
    poi.floor < 0 &&
    !NEGATIVE_FLOOR_CATEGORY_SET.has(poi.category)
  ) {
    issues.push(
      issue(
        'floor-negative-category',
        'floor',
        `负楼层（${poi.floor}）只允许地下车库（parking-garage），当前分类是 ${String(poi.category)}`,
      ),
    );
  }

  if (!isCampusPoiSource(poi.source)) {
    issues.push(issue('source-unknown', 'source', `未知来源：${String(poi.source)}`));
  }

  if (!Array.isArray(poi.photoUrls)) {
    issues.push(issue('photo-urls-invalid', 'photoUrls', 'photoUrls 必须是数组'));
  } else {
    for (const url of poi.photoUrls) {
      if (typeof url !== 'string' || url.trim() === '') {
        issues.push(issue('photo-url-empty', 'photoUrls', '照片 URL 不能是空串'));
      } else if (isForbiddenPhotoUrl(url)) {
        issues.push(
          issue(
            'photo-url-forbidden-origin',
            'photoUrls',
            '该照片来源已被明令禁止（另一个参赛组拍摄，著作权归拍摄者）；请改用有授权的素材',
          ),
        );
      }
    }

    // ⚠️ 版权合规硬要求：有照片就必须有拍摄者署名。
    if (poi.photoUrls.length > 0) {
      const credit = typeof poi.photoCredit === 'string' ? poi.photoCredit.trim() : '';
      if (credit === '') {
        issues.push(
          issue(
            'photo-credit-required',
            'photoCredit',
            '有照片时必须填写 photoCredit（拍摄者/授权方署名）；未获授权的照片不得录入',
          ),
        );
      }
    }
  }

  if (poi.verifiedAt !== null) {
    if (typeof poi.verifiedAt !== 'string' || Number.isNaN(Date.parse(poi.verifiedAt))) {
      issues.push(issue('verified-at-invalid', 'verifiedAt', 'verifiedAt 必须是可解析的时间或 null'));
    }
  }

  return issues;
}

/* ------------------------------------------------------------------ *
 * 外部录入闸门（管理员 / 用户自己录入合法内容）
 * ------------------------------------------------------------------ */

/** 外部录入的结果：要么通过并拿到规范对象，要么带着问题列表被拒 */
export type CampusPoiImportResult =
  | { readonly ok: true; readonly poi: CampusPoiSupplement }
  | { readonly ok: false; readonly issues: readonly CampusPoiIssue[] };

/**
 * 外部录入（管理员后台 / 用户提交）的**唯一闸门**：先校验，再入库。
 *
 * 本函数不下载图片、不补默认署名、不「先入库再补授权」：
 * 带照片但没写 `photoCredit` 的提交会直接被拒。调用方拿到 `ok: false` 后
 * 应当把 `issues` 原样展示给录入者，而不是自行猜测怎么修。
 */
export function importPoiSupplement(candidate: CampusPoiSupplement): CampusPoiImportResult {
  const issues = validatePoiSupplement(candidate);
  if (issues.length === 0) return { ok: true, poi: candidate };
  return { ok: false, issues };
}

/* ------------------------------------------------------------------ *
 * 空模型（用户 / 管理员录入的起点）
 * ------------------------------------------------------------------ */

export interface CampusPoiDraftInput {
  readonly id: string;
  readonly category: CampusPoiCategory;
  readonly name: string;
  readonly lat: number;
  readonly lng: number;
  readonly floor?: number | null;
}

/**
 * 创建一条**空**的补充 POI：没有照片、没有署名、未核实、来源未知。
 *
 * 这是「先建模、后录入」的落点：位置与分类由调用方给出，其余字段留空。
 * 带照片的录入必须自己补 `photoCredit` 并重新跑 [validatePoiSupplement]。
 * 本函数**不会**从任何 URL 下载图片。
 */
export function createPoiDraft(input: CampusPoiDraftInput): CampusPoiSupplement {
  return {
    id: input.id,
    category: input.category,
    name: input.name,
    lat: input.lat,
    lng: input.lng,
    floor: input.floor ?? null,
    description: null,
    openingHours: null,
    photoUrls: [],
    photoCredit: null,
    verifiedAt: null,
    source: 'unknown',
  };
}

/* ------------------------------------------------------------------ *
 * 地图叠加层投影
 * ------------------------------------------------------------------ */

/**
 * 地图叠加层需要的最小形状。
 *
 * 坐标保持 **WGS84**：Web 的 OSM 底图直接吃 WGS84（不经过 GCJ-02）。
 * 小程序若用腾讯/高德底图，渲染前再自行转 GCJ-02 —— 这个转换不属于本契约，
 * 也不允许把转换结果写回 `CampusPoiSupplement`。
 */
export interface CampusPoiMapMarker {
  readonly id: string;
  readonly label: string;
  readonly lat: number;
  readonly lng: number;
  readonly category: CampusPoiCategory;
  readonly categoryLabel: string;
  readonly floor: number | null;
  /** 语义色调名；色值由渲染层从 design-tokens 取 */
  readonly tone: CampusPoiTone;
  /** 是否有已授权照片（无照片时不显示相册入口） */
  readonly hasPhotos: boolean;
  /** 有照片时的拍摄者署名；无照片时为 `null` */
  readonly photoCredit: string | null;
}

/**
 * POI → 地图叠加层形状。
 *
 * 纯投影，不校验、不下载图片。运行时遇到未知分类会归一到 `other`
 *（这样脏数据至少还能画出来；入库前仍应先过 [validatePoiSupplement]）。
 */
export function poiToMapMarker(poi: CampusPoiSupplement): CampusPoiMapMarker {
  const category: CampusPoiCategory = isCampusPoiCategory(poi.category) ? poi.category : 'other';
  const hasPhotos = Array.isArray(poi.photoUrls) && poi.photoUrls.length > 0;

  return {
    id: poi.id,
    label: poi.name,
    lat: poi.lat,
    lng: poi.lng,
    category,
    categoryLabel: CAMPUS_POI_CATEGORY_LABELS[category],
    floor: poi.floor,
    tone: CAMPUS_POI_CATEGORY_TONES[category],
    hasPhotos,
    photoCredit: hasPhotos ? poi.photoCredit : null,
  };
}

/* ------------------------------------------------------------------ *
 * 与课程 / 活动 / 日程的时间关联
 * ------------------------------------------------------------------ */

/** 一条时间性安排的来源类型 */
export const POI_TIME_SLOT_KINDS = ['course', 'event', 'exam', 'personal'] as const;

export type PoiTimeSlotKind = (typeof POI_TIME_SLOT_KINDS)[number];

/**
 * 挂在某个 POI 上的一段时间。
 *
 * 时间字符串使用 ISO 8601；**生产方必须带时区偏移**（`+08:00` 或 `Z`），
 * 否则不同端会按各自本地时区解析出不同瞬间。本契约的计算函数用
 * `Date.parse` 取毫秒，区间语义是**左闭右开** `[startsAt, endsAt)`：
 * 10:30 结束的课与 10:30 开始的日程不算冲突。
 */
export interface PoiTimeSlot {
  /** 关联的 `CampusPoiSupplement.id` */
  readonly poiId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly kind: PoiTimeSlotKind;
  readonly title: string;
  /** 指回课程/活动的稳定 id；个人日程可以为 `null` */
  readonly sourceRef: string | null;
}

/** 某个时刻某个 POI 上正在进行的安排 */
export interface PoiActiveSlots {
  readonly poiId: string;
  readonly poi: CampusPoiSupplement;
  readonly slots: readonly PoiTimeSlot[];
}

interface SlotWindow {
  readonly slot: PoiTimeSlot;
  readonly start: number;
  readonly end: number;
}

/** 解析为合法时间窗；无效（空 poiId / 时间不可解析 / 结束不晚于开始）返回 null */
function slotWindow(slot: PoiTimeSlot): SlotWindow | null {
  if (typeof slot.poiId !== 'string' || slot.poiId === '') return null;
  if (typeof slot.startsAt !== 'string' || typeof slot.endsAt !== 'string') return null;

  const start = Date.parse(slot.startsAt);
  const end = Date.parse(slot.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;

  return { slot, start, end };
}

function toEpoch(value: Date | string): number | null {
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function byStartThenTitle(a: SlotWindow, b: SlotWindow): number {
  if (a.start !== b.start) return a.start - b.start;
  if (a.end !== b.end) return a.end - b.end;
  if (a.slot.title === b.slot.title) return 0;
  return a.slot.title < b.slot.title ? -1 : 1;
}

/**
 * 找出 `at` 这一刻**正在进行的**全部 POI 安排（左闭右开）。
 *
 * - 只返回 `pois` 里存在、且 `slots` 里时间窗覆盖 `at` 的项；
 * - 结果按传入 `pois` 的顺序返回；每个 POI 的 `slots` 按开始时间、结束时间、
 *   标题排序，结果可复现；
 * - `at` 不可解析、或 slot 指向不存在的 POI 时，对应项被忽略（不抛错）。
 *
 * 典型用途：地图高亮「现在有课的楼」「正在进行活动的场地」。
 */
export function findPoiSlotsAt(
  pois: readonly CampusPoiSupplement[],
  slots: readonly PoiTimeSlot[],
  at: Date | string,
): PoiActiveSlots[] {
  const instant = toEpoch(at);
  if (instant === null) return [];

  const active = new Map<string, SlotWindow[]>();
  for (const slot of slots) {
    const window = slotWindow(slot);
    if (window === null) continue;
    if (!(window.start <= instant && instant < window.end)) continue;

    const list = active.get(window.slot.poiId);
    if (list === undefined) active.set(window.slot.poiId, [window]);
    else list.push(window);
  }

  const result: PoiActiveSlots[] = [];
  const emitted = new Set<string>();
  for (const poi of pois) {
    if (emitted.has(poi.id)) continue;
    const windows = active.get(poi.id);
    if (windows === undefined) continue;

    emitted.add(poi.id);
    result.push({
      poiId: poi.id,
      poi,
      slots: windows.sort(byStartThenTitle).map((window) => window.slot),
    });
  }
  return result;
}

/**
 * 这个地点**下一个**安排（「下一站」）：
 * 返回 `endsAt > now` 的最早一条，因此**正在进行中的安排也算**（不会跳过
 * 一堂还在上的课）；已结束的、别的 POI 的、时间非法的都不算。
 *
 * `now` 不可解析时返回 `null`（fail closed，不猜）。
 */
export function nextSlotAt(
  poi: CampusPoiSupplement,
  slots: readonly PoiTimeSlot[],
  now: Date | string,
): PoiTimeSlot | null {
  const instant = toEpoch(now);
  if (instant === null) return null;

  const candidates: SlotWindow[] = [];
  for (const slot of slots) {
    if (slot.poiId !== poi.id) continue;
    const window = slotWindow(slot);
    if (window === null || window.end <= instant) continue;
    candidates.push(window);
  }

  candidates.sort(byStartThenTitle);
  return candidates[0]?.slot ?? null;
}

/** 同一 POI 上两段时间的重叠 */
export interface PoiSlotConflict {
  readonly poiId: string;
  /** 开始更早的那段 */
  readonly earlier: PoiTimeSlot;
  /** 开始更晚、但与 earlier 重叠的那段 */
  readonly later: PoiTimeSlot;
  /** 重叠毫秒数（用于 UI 说明「冲突 30 分钟」） */
  readonly overlapMs: number;
}

/**
 * 找出同一 POI 上**互相重叠**的时间安排（两两判定）。
 *
 * 判定规则：只比较同一 `poiId`；区间左闭右开，`a.endsAt === b.startsAt`
 * 属于**相邻不冲突**（课 10:30 下课、日程 10:30 开始）。时间非法
 * （结束不晚于开始 / 不可解析）的 slot 直接忽略，不产生冲突。
 *
 * 注意：这里只回答「时间上撞了」，不判断「该不该允许」——
 * 例如「个人日程 vs 课程」是否允许共存，是产品策略，不属于本契约。
 */
export function findPoiSlotConflicts(slots: readonly PoiTimeSlot[]): PoiSlotConflict[] {
  const byPoi = new Map<string, SlotWindow[]>();
  for (const slot of slots) {
    const window = slotWindow(slot);
    if (window === null) continue;

    const list = byPoi.get(window.slot.poiId);
    if (list === undefined) byPoi.set(window.slot.poiId, [window]);
    else list.push(window);
  }

  const conflicts: PoiSlotConflict[] = [];
  for (const [poiId, windows] of byPoi) {
    windows.sort(byStartThenTitle);
    for (let i = 0; i < windows.length; i += 1) {
      const earlier = windows[i];
      if (earlier === undefined) continue;

      for (let j = i + 1; j < windows.length; j += 1) {
        const later = windows[j];
        if (later === undefined) continue;
        // 已按 start 排序：later.start >= earlier.end 时，后面的更不可能与 earlier 重叠
        if (later.start >= earlier.end) break;

        conflicts.push({
          poiId,
          earlier: earlier.slot,
          later: later.slot,
          overlapMs: Math.min(earlier.end, later.end) - later.start,
        });
      }
    }
  }

  conflicts.sort((a, b) => {
    if (a.poiId !== b.poiId) return a.poiId < b.poiId ? -1 : 1;
    const byEarlier = Date.parse(a.earlier.startsAt) - Date.parse(b.earlier.startsAt);
    if (byEarlier !== 0) return byEarlier;
    return Date.parse(a.later.startsAt) - Date.parse(b.later.startsAt);
  });

  return conflicts;
}
