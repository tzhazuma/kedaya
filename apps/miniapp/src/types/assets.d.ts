/**
 * 非代码资源的模块声明。
 *
 * 小程序端样式由 webpack 处理，TS 需要知道 `import './x.scss'` 是合法的。
 */

declare module '*.scss' {
  const content: string
  export default content
}

declare module '*.css' {
  const content: string
  export default content
}

declare module '*.png' {
  const src: string
  export default src
}

declare module '*.svg' {
  const src: string
  export default src
}
