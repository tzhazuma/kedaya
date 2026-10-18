/**
 * 吉祥物贴图路径 —— 与 `mapColors.ts` 的 `MAP_MARKER_ICONS` 同一个模式：
 * 图片**原样拷贝**进 `dist/assets/`（见 `config/index.ts` 的 `copy.patterns`），
 * 代码里以「小程序根目录绝对路径」引用。
 *
 * 为什么不 `import duck from '.../duck.png'`：那会走 webpack 的 asset 规则，
 * 小于阈值的图会被 base64 内联进 JS（主包体积白白变大），大于阈值的会产出
 * 带 hash 的文件名，路径不可预测。吉祥物是"品牌资产"，路径固定更利于排查
 * （真机上白图时，第一件事就是看这个路径在不在 `dist/assets/mascot/` 里）。
 *
 * 图案是**自绘的原创鸭子**（黄身 + 橙喙 + 三根呆毛），色值取自品牌黄体系，
 * 所以它和页面的品牌渐变是同一族色。等拿到官方美术资源后，替换同名文件即可，
 * 页面代码一行都不用改。
 */
export const DUCK_MASCOT_SRC = '/assets/mascot/duck.png'
