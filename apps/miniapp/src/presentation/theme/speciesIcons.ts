/**
 * 物种头像 —— 档案页里每个物种的那张小图。
 *
 * 为什么用位图而不是图标字体：这些图是**动物插画**（原型的野生动物模块带来的），
 * 图标字体里没有一个能表达「黑天鹅 / 猫 / 小鸟」的区别，用统一的 `AppsOutlined`
 * 会让档案页退化成一行行灰字。
 *
 * ⚠️ 三张图覆盖七个物种：猫与黑天鹅各有专属图，其余五个（绿头鸭、麻雀、
 * 珠颈斑鸠、白鹭、喜鹊）共用「鸟」这张。**不假装**每个物种都有专属插画 ——
 * 没图画的那几个共用一张，比编一张不准的图更诚实。
 *
 * ⚠️ 这里以 `speciesId` 为键，而物种清单来自服务端。服务端新增物种时
 * 这里会**返回 null**，页面显示首字占位（见 `pages/wildlife/archive`）——
 * 不认识就说不认识，而不是随便配一张图。
 * `__tests__/speciesIcons.test.ts` 守住「内置物种一个都不能漏」。
 */
const SPECIES_ICON_PATHS: Readonly<Record<string, string>> = {
  'sp-cat': '/assets/wildlife/species-cat.png',
  'sp-black-swan': '/assets/wildlife/species-swan.png',
  // 鸟形（小图，够分辨"这是一只鸟"）
  'sp-mallard': '/assets/wildlife/species-bird.png',
  'sp-sparrow': '/assets/wildlife/species-bird.png',
  'sp-dove': '/assets/wildlife/species-bird.png',
  'sp-egret': '/assets/wildlife/species-bird.png',
  'sp-magpie': '/assets/wildlife/species-bird.png',
}

/** 物种头像路径；没有专属图时返回 `null`（页面用首字占位） */
export function speciesIconPath(speciesId: string): string | null {
  return SPECIES_ICON_PATHS[speciesId] ?? null
}
