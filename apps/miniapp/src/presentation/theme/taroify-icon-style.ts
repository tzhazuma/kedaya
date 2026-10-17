/**
 * Taroify 图标样式入口 —— 本文件通过 `config/index.ts` 的 `alias` 覆盖了
 * `@taroify/icons/style/index.js`。
 *
 * 背景：原入口只做两件事 —— `import '../van/index.scss'`（@font-face + 全部
 * `.van-icon-*:before` 字形映射）与 `import '../styles/icon.scss'`（图标尺寸/颜色修饰类）。
 * 其中 `@font-face` 的 `src` 指向 `//at.alicdn.com/...`：
 *
 *   - 协议相对地址（`//`）在部分微信基础库下不解析；
 *   - 即使解析成 https，真机也要求把 `at.alicdn.com` 加进合法域名，否则图标全变空白方框；
 *   - 断网 / 内网调试时必然拿不到字形。
 *
 * 这里保持原入口的语义（先加载官方样式，保留全部字形映射），
 * **紧接着**再声明一次同族名 `vant-icon` 的 `@font-face`，把 src 换成 base64 内联字体。
 * CSS 中同族名「后声明者生效」，因此这条会覆盖官方那条，图标不再依赖网络。
 *
 * 注意导入顺序不能改：`icon-font.scss` 必须在官方样式**之后**。
 */
import '@taroify/icons/van/index.scss'
import '@taroify/icons/styles/icon.scss'
import './icon-font.scss'
