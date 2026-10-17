/**
 * 运行时模块解析补丁（打包产物专用，`node -r` 预加载）。
 *
 * ## 为什么需要它
 *
 * `@kedaya/contracts` / `@kedaya/shared` 的 `package.json` 把入口指向
 * **TypeScript 源码**（`main: ./src/index.ts`），因为小程序 / Web 都由打包器
 * 直接吃 TS，不需要中间产物。但服务端是 `tsc` 编译后由 Node 直接跑 CJS，
 * Node 顺着 `node_modules` 软链找到 `src/index.ts` 时会试图做类型擦除，
 * 并因为包内部的 extensionless 相对导入（`./envelope`）而失败：
 *
 *     Error [ERR_MODULE_NOT_FOUND]: Cannot find module
 *     '.../packages/contracts/src/envelope'
 *
 * 我们的 `tsconfig.json` 故意把 `rootDir` 指到仓库根，于是 `tsc` 已经把这几个包
 * **一并编译**成了 CJS 放在 `dist/packages/...`。缺的只是"让 Node 去那里找"。
 * 这个补丁做的就这一件事，不引入任何新依赖。
 *
 * ## 边界
 *
 *   · 只在打包产物里生效（`npm run start` / `dev:serve`）；`tsc` 类型检查、
 *     vitest、小程序构建全都不受影响 —— 它们走各自的解析器；
 *   · 只重定向这两个工作区包，其他模块一律交给原始解析器，避免掩盖真实的
 *     "模块找不到"问题。
 */
const path = require('node:path');
const Module = require('node:module');

/** tsc 产出的根（本文件在 `services/api/`，产物在 `services/api/dist/packages/` 下） */
const DIST_ROOT = path.join(__dirname, 'dist', 'packages');

const ALIASES = {
  '@kedaya/contracts': path.join(DIST_ROOT, 'contracts', 'src'),
  '@kedaya/shared': path.join(DIST_ROOT, 'shared', 'src'),
};

const originalResolve = Module._resolveFilename;

Module._resolveFilename = function resolveFromDist(request, ...rest) {
  for (const [packageName, directory] of Object.entries(ALIASES)) {
    if (request === packageName) {
      return originalResolve.call(this, path.join(directory, 'index.js'), ...rest);
    }
    if (request.startsWith(`${packageName}/`)) {
      const subpath = request.slice(packageName.length + 1);
      return originalResolve.call(this, path.join(directory, `${subpath}.js`), ...rest);
    }
  }
  return originalResolve.call(this, request, ...rest);
};
