/**
 * 校园 POI 照片清单 · **上科大一图通（map.niyiwei.com）授权借用**
 *
 * ⚠️ 本文件由 `tools/import-niyiwei-photos.mjs` 生成，**不要手改**。
 *
 * ## 授权与可撤回性
 *
 * 项目负责人唐志昊已**口头**获得对方参赛组同意，允许合并其地下车库照片与
 * 食堂菜单照片；**没有书面文件**。因此这里按「可撤回的借用」实现：
 *
 *   · 每条照片都带 `credit`（来源方署名）与 `sourceUrl`；
 *   · 开关 `NIYIWEI_PHOTOS_ENABLED` 为 `false` 时，`activeNiyiweiPhotos()` 返回空；
 *   · 一条命令下架（不需要网络）：
 *       `node tools/import-niyiwei-photos.mjs --revoke`
 *   · 恢复：`node tools/import-niyiwei-photos.mjs --restore`。
 *
 * ## 体积
 *
 * 照片**不打包**，只用远程 URL。实测 54 张原图共约 31.41 MiB，而微信主包上限
 * 2 MiB —— 打进包会直接上传失败。部署时需把 `map.niyiwei.com` 加入小程序
 * 后台的「downloadFile 合法域名」，否则真机不显示（远程图仍需要域名白名单）。
 *
 * ## 只借用照片
 *
 * 清单只含照片地址与来源方署名，不含对方站点的菜品、价格、评论或任何用户数据。
 */

export const NIYIWEI_PHOTO_ORIGIN = 'https://map.niyiwei.com'

/** 来源方署名（著作权归对方拍摄者；对方未逐张标注姓名，这里署名到参赛组粒度） */
export const NIYIWEI_PHOTO_CREDIT = '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权'

/** 授权元数据：**口头**授权，无可归档的书面凭证 */
export const NIYIWEI_PHOTO_AUTHORIZATION = {
  authorizedBy: '唐志昊（可达鸭项目负责人）',
  mode: 'oral',
  grantedAt: '2026-10-20',
  evidence: null,
  revocable: true,
} as const

export const NIYIWEI_PHOTOS_ENABLED = true

/** 一键下架命令（断网可执行） */
export const NIYIWEI_PHOTOS_REVOKE_COMMAND = 'node tools/import-niyiwei-photos.mjs --revoke'

export interface CampusPoiPhoto {
  /** 稳定 POI id；同一摊位的多张菜单共享一个 id */
  readonly poiId: string;
  /** 展示标题（含「菜单 n/m」序号） */
  readonly title: string;
  /** 远程图片 URL（不打包） */
  readonly url: string;
  /** 来源方署名 —— 非空是硬要求 */
  readonly credit: string;
  /** 原始出处（与 url 相同；保留字段以便日后换成页面地址） */
  readonly sourceUrl: string;
}

export const NIYIWEI_PHOTOS: readonly CampusPoiPhoto[] = [
  {
    poiId: 'niyiwei-parking-garage-b1',
    title: 'A 区（信息学院地下空间）放大图',
    url: 'https://map.niyiwei.com/data/underground/garage-a-space-map.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/data/underground/garage-a-space-map.jpg',
  },
  {
    poiId: 'niyiwei-parking-garage-b1',
    title: '地下车库整体行车路线导向图（东侧）',
    url: 'https://map.niyiwei.com/data/underground/garage-traffic-overview-east.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/data/underground/garage-traffic-overview-east.jpg',
  },
  {
    poiId: 'niyiwei-parking-garage-b1',
    title: '地下车库整体行车路线导向图（西侧）',
    url: 'https://map.niyiwei.com/data/underground/garage-traffic-overview-west.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/data/underground/garage-traffic-overview-west.jpg',
  },
  {
    poiId: 'niyiwei-parking-garage-b1',
    title: '地下车库整体行车路线导向图',
    url: 'https://map.niyiwei.com/data/underground/garage-traffic-overview.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/data/underground/garage-traffic-overview.jpg',
  },
  {
    poiId: 'niyiwei-parking-garage-b1',
    title: '信息学院地下车库平面图',
    url: 'https://map.niyiwei.com/data/underground/info-garage-plan.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/data/underground/info-garage-plan.jpg',
  },
  {
    poiId: 'niyiwei-parking-garage-b1',
    title: '信息学院地下车库行车路线图',
    url: 'https://map.niyiwei.com/data/underground/info-garage-traffic.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/data/underground/info-garage-traffic.jpg',
  },
  {
    poiId: 'niyiwei-stall-c1-1f-beefnoodle',
    title: '手工牛肉面 · 菜单 1/2',
    url: 'https://map.niyiwei.com/photos/menus/c1-1f-beefnoodle-1.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c1-1f-beefnoodle-1.jpg',
  },
  {
    poiId: 'niyiwei-stall-c1-1f-beefnoodle',
    title: '手工牛肉面 · 菜单 2/2',
    url: 'https://map.niyiwei.com/photos/menus/c1-1f-beefnoodle-2.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c1-1f-beefnoodle-2.jpg',
  },
  {
    poiId: 'niyiwei-stall-c1-1f-breakfast',
    title: '早餐 · 菜单 1/1',
    url: 'https://map.niyiwei.com/photos/menus/c1-1f-breakfast-1.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c1-1f-breakfast-1.jpg',
  },
  {
    poiId: 'niyiwei-stall-c1-1f-youpo',
    title: '陕西油泼面 · 菜单 1/2',
    url: 'https://map.niyiwei.com/photos/menus/c1-1f-youpo-1.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c1-1f-youpo-1.jpg',
  },
  {
    poiId: 'niyiwei-stall-c1-1f-youpo',
    title: '陕西油泼面 · 菜单 2/2',
    url: 'https://map.niyiwei.com/photos/menus/c1-1f-youpo-2.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c1-1f-youpo-2.jpg',
  },
  {
    poiId: 'niyiwei-stall-c1-1f-ziyuan',
    title: '自选美食 · 菜单 1/2',
    url: 'https://map.niyiwei.com/photos/menus/c1-1f-ziyuan-1.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c1-1f-ziyuan-1.jpg',
  },
  {
    poiId: 'niyiwei-stall-c1-1f-ziyuan',
    title: '自选美食 · 菜单 2/2',
    url: 'https://map.niyiwei.com/photos/menus/c1-1f-ziyuan-2.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c1-1f-ziyuan-2.jpg',
  },
  {
    poiId: 'niyiwei-stall-c1-2f-chicken',
    title: '牛奶炸鸡 · 菜单 1/2',
    url: 'https://map.niyiwei.com/photos/menus/c1-2f-chicken-1.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c1-2f-chicken-1.jpg',
  },
  {
    poiId: 'niyiwei-stall-c1-2f-chicken',
    title: '牛奶炸鸡 · 菜单 2/2',
    url: 'https://map.niyiwei.com/photos/menus/c1-2f-chicken-2.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c1-2f-chicken-2.jpg',
  },
  {
    poiId: 'niyiwei-stall-c1-2f-claypot',
    title: '砂锅（煲仔饭） · 菜单 2/3',
    url: 'https://map.niyiwei.com/photos/menus/c1-2f-claypot-1.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c1-2f-claypot-1.jpg',
  },
  {
    poiId: 'niyiwei-stall-c1-2f-claypot',
    title: '砂锅（煲仔饭） · 菜单 3/3',
    url: 'https://map.niyiwei.com/photos/menus/c1-2f-claypot-2.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c1-2f-claypot-2.jpg',
  },
  {
    poiId: 'niyiwei-stall-c1-2f-claypot',
    title: '砂锅（煲仔饭） · 菜单 1/3',
    url: 'https://map.niyiwei.com/photos/menus/c1-2f-claypot-20261016.png',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c1-2f-claypot-20261016.png',
  },
  {
    poiId: 'niyiwei-stall-c1-2f-hulatang',
    title: '非遗膳点（胡辣汤） · 菜单 2/3',
    url: 'https://map.niyiwei.com/photos/menus/c1-2f-hulatang-1.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c1-2f-hulatang-1.jpg',
  },
  {
    poiId: 'niyiwei-stall-c1-2f-hulatang',
    title: '非遗膳点（胡辣汤） · 菜单 3/3',
    url: 'https://map.niyiwei.com/photos/menus/c1-2f-hulatang-2.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c1-2f-hulatang-2.jpg',
  },
  {
    poiId: 'niyiwei-stall-c1-2f-hulatang',
    title: '非遗膳点（胡辣汤） · 菜单 1/3',
    url: 'https://map.niyiwei.com/photos/menus/c1-2f-hulatang-20261016.png',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c1-2f-hulatang-20261016.png',
  },
  {
    poiId: 'niyiwei-stall-c1-2f-mifen',
    title: '米粉 · 菜单 1/2',
    url: 'https://map.niyiwei.com/photos/menus/c1-2f-mifen-1.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c1-2f-mifen-1.jpg',
  },
  {
    poiId: 'niyiwei-stall-c1-2f-mifen',
    title: '米粉 · 菜单 2/2',
    url: 'https://map.niyiwei.com/photos/menus/c1-2f-mifen-2.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c1-2f-mifen-2.jpg',
  },
  {
    poiId: 'niyiwei-stall-c2-1f-breakfast',
    title: '早餐 · 菜单 1/1',
    url: 'https://map.niyiwei.com/photos/menus/c2-1f-breakfast-1.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c2-1f-breakfast-1.jpg',
  },
  {
    poiId: 'niyiwei-stall-c2-1f-jianbing',
    title: '杂粮煎饼 · 菜单 1/1',
    url: 'https://map.niyiwei.com/photos/menus/c2-1f-jianbing-1.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c2-1f-jianbing-1.jpg',
  },
  {
    poiId: 'niyiwei-stall-c2-1f-light',
    title: '轻食 · 菜单 1/1',
    url: 'https://map.niyiwei.com/photos/menus/c2-1f-light-1.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c2-1f-light-1.jpg',
  },
  {
    poiId: 'niyiwei-stall-c2-1f-ziyuan',
    title: '自选快餐 · 菜单 1/4',
    url: 'https://map.niyiwei.com/photos/menus/c2-1f-ziyuan-1.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c2-1f-ziyuan-1.jpg',
  },
  {
    poiId: 'niyiwei-stall-c2-1f-ziyuan',
    title: '自选快餐 · 菜单 2/4',
    url: 'https://map.niyiwei.com/photos/menus/c2-1f-ziyuan-2.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c2-1f-ziyuan-2.jpg',
  },
  {
    poiId: 'niyiwei-stall-c2-1f-ziyuan',
    title: '自选快餐 · 菜单 3/4',
    url: 'https://map.niyiwei.com/photos/menus/c2-1f-ziyuan-3.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c2-1f-ziyuan-3.jpg',
  },
  {
    poiId: 'niyiwei-stall-c2-1f-ziyuan',
    title: '自选快餐 · 菜单 4/4',
    url: 'https://map.niyiwei.com/photos/menus/c2-1f-ziyuan-4.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c2-1f-ziyuan-4.jpg',
  },
  {
    poiId: 'niyiwei-stall-c2-2f-daoxiao',
    title: '刀削面 · 菜单 1/2',
    url: 'https://map.niyiwei.com/photos/menus/c2-2f-daoxiao-1.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c2-2f-daoxiao-1.jpg',
  },
  {
    poiId: 'niyiwei-stall-c2-2f-daoxiao',
    title: '刀削面 · 菜单 2/2',
    url: 'https://map.niyiwei.com/photos/menus/c2-2f-daoxiao-2.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c2-2f-daoxiao-2.jpg',
  },
  {
    poiId: 'niyiwei-stall-c2-2f-dumpling',
    title: '水饺 · 菜单 1/1',
    url: 'https://map.niyiwei.com/photos/menus/c2-2f-dumpling-1.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c2-2f-dumpling-1.jpg',
  },
  {
    poiId: 'niyiwei-stall-c2-2f-huadan',
    title: '滑蛋饭 · 菜单 1/1',
    url: 'https://map.niyiwei.com/photos/menus/c2-2f-huadan-1.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c2-2f-huadan-1.jpg',
  },
  {
    poiId: 'niyiwei-stall-c2-2f-mala',
    title: '麻辣烫 · 麻辣香锅 · 菜单 1/3',
    url: 'https://map.niyiwei.com/photos/menus/c2-2f-mala-1.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c2-2f-mala-1.jpg',
  },
  {
    poiId: 'niyiwei-stall-c2-2f-mala',
    title: '麻辣烫 · 麻辣香锅 · 菜单 2/3',
    url: 'https://map.niyiwei.com/photos/menus/c2-2f-mala-2.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c2-2f-mala-2.jpg',
  },
  {
    poiId: 'niyiwei-stall-c2-2f-mala',
    title: '麻辣烫 · 麻辣香锅 · 菜单 3/3',
    url: 'https://map.niyiwei.com/photos/menus/c2-2f-mala-3.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c2-2f-mala-3.jpg',
  },
  {
    poiId: 'niyiwei-stall-c2-2f-mofan',
    title: '魔饭青年 · 菜单 1/2',
    url: 'https://map.niyiwei.com/photos/menus/c2-2f-mofan-1.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c2-2f-mofan-1.jpg',
  },
  {
    poiId: 'niyiwei-stall-c2-2f-mofan',
    title: '魔饭青年 · 菜单 2/2',
    url: 'https://map.niyiwei.com/photos/menus/c2-2f-mofan-2.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c2-2f-mofan-2.jpg',
  },
  {
    poiId: 'niyiwei-stall-c2-2f-teppan',
    title: '铁板烧 · 菜单 1/1',
    url: 'https://map.niyiwei.com/photos/menus/c2-2f-teppan-1.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c2-2f-teppan-1.jpg',
  },
  {
    poiId: 'niyiwei-stall-c2-2f-xiaomian',
    title: '重庆小面 · 菜单 1/2',
    url: 'https://map.niyiwei.com/photos/menus/c2-2f-xiaomian-1.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c2-2f-xiaomian-1.jpg',
  },
  {
    poiId: 'niyiwei-stall-c2-2f-xiaomian',
    title: '重庆小面 · 菜单 2/2',
    url: 'https://map.niyiwei.com/photos/menus/c2-2f-xiaomian-2.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c2-2f-xiaomian-2.jpg',
  },
  {
    poiId: 'niyiwei-stall-c3-1f-mala',
    title: '香锅冒菜 · 菜单 1/3',
    url: 'https://map.niyiwei.com/photos/menus/c3-1f-mala-1.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c3-1f-mala-1.jpg',
  },
  {
    poiId: 'niyiwei-stall-c3-1f-mala',
    title: '香锅冒菜 · 菜单 2/3',
    url: 'https://map.niyiwei.com/photos/menus/c3-1f-mala-2.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c3-1f-mala-2.jpg',
  },
  {
    poiId: 'niyiwei-stall-c3-1f-mala',
    title: '香锅冒菜 · 菜单 3/3',
    url: 'https://map.niyiwei.com/photos/menus/c3-1f-mala-3.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c3-1f-mala-3.jpg',
  },
  {
    poiId: 'niyiwei-stall-c3-1f-mixian',
    title: '鲜烫米线 · 菜单 1/1',
    url: 'https://map.niyiwei.com/photos/menus/c3-1f-mixian-1.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c3-1f-mixian-1.jpg',
  },
  {
    poiId: 'niyiwei-stall-c3-1f-noodle',
    title: '特色面档 · 菜单 1/2',
    url: 'https://map.niyiwei.com/photos/menus/c3-1f-noodle-1.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c3-1f-noodle-1.jpg',
  },
  {
    poiId: 'niyiwei-stall-c3-1f-noodle',
    title: '特色面档 · 菜单 2/2',
    url: 'https://map.niyiwei.com/photos/menus/c3-1f-noodle-2.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c3-1f-noodle-2.jpg',
  },
  {
    poiId: 'niyiwei-stall-c3-1f-roast',
    title: '港式烧腊 · 菜单 1/1',
    url: 'https://map.niyiwei.com/photos/menus/c3-1f-roast-1.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c3-1f-roast-1.jpg',
  },
  {
    poiId: 'niyiwei-stall-c3-1f-steak',
    title: '上品牛排 · 菜单 1/1',
    url: 'https://map.niyiwei.com/photos/menus/c3-1f-steak-1.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c3-1f-steak-1.jpg',
  },
  {
    poiId: 'niyiwei-stall-c3-1f-teppan',
    title: '铁板烧 · 菜单 1/1',
    url: 'https://map.niyiwei.com/photos/menus/c3-1f-teppan-1.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c3-1f-teppan-1.jpg',
  },
  {
    poiId: 'niyiwei-stall-c3-1f-ziyuan',
    title: '自选 · 菜单 1/2',
    url: 'https://map.niyiwei.com/photos/menus/c3-1f-ziyuan-1.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c3-1f-ziyuan-1.jpg',
  },
  {
    poiId: 'niyiwei-stall-c3-1f-ziyuan',
    title: '自选 · 菜单 2/2',
    url: 'https://map.niyiwei.com/photos/menus/c3-1f-ziyuan-2.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/c3-1f-ziyuan-2.jpg',
  },
  {
    poiId: 'niyiwei-stall-nestart-coffee',
    title: '咖啡饮品 · 菜单 1/1',
    url: 'https://map.niyiwei.com/photos/menus/nestart-coffee-20261016.jpg',
    credit: '上科大一图通参赛组（map.niyiwei.com）· 2026-10-20 经项目负责人唐志昊口头授权',
    sourceUrl: 'https://map.niyiwei.com/photos/menus/nestart-coffee-20261016.jpg',
  },
];

/** 当前生效的照片：撤回后恒为空数组（调用方无需分支） */
export function activeNiyiweiPhotos(): readonly CampusPoiPhoto[] {
  return NIYIWEI_PHOTOS_ENABLED ? NIYIWEI_PHOTOS : [];
}

/** 某个 POI 的照片（撤回后为空） */
export function niyiweiPhotosForPoi(poiId: string): readonly CampusPoiPhoto[] {
  return activeNiyiweiPhotos().filter((photo) => photo.poiId === poiId);
}

/** 自检：返回问题列表（空数组 = 通过）。每条照片必须有非空署名。 */
export function validateNiyiweiPhotos(): string[] {
  const issues: string[] = [];
  for (const photo of NIYIWEI_PHOTOS) {
    if (photo.credit.trim() === '') issues.push(`${photo.url} 缺署名`);
    if (!photo.url.startsWith(NIYIWEI_PHOTO_ORIGIN + '/')) issues.push(`${photo.url} 不在授权域名`);
  }
  return issues;
}
