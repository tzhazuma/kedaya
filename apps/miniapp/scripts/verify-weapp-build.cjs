// 检查发布包，而不是仅检查 TS 类型：微信环境没有 Node process。
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '../dist');
const vm = require('node:vm');
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const factories = {};
let fingerprint;
for (const file of fs.readdirSync(root, { recursive: true }).filter(name => name.endsWith('.js'))) {
  const code = fs.readFileSync(path.join(root, file), 'utf8');
  assert.ok(!/process\.env\.TARO_APP_/.test(code), `${file}: found uncompiled environment access`);
  assert.ok(!/KEDAYA_(?:EXPORTS|UNDEFINED_JSX|MISSING_MODULE)/.test(code), `${file}: temporary diagnostics remain`);
  const stamp = code.match(/\/\/ kedaya-build:([a-f0-9]+)/)?.[1];
  assert.ok(stamp, `${file}: missing build fingerprint`);
  fingerprint ??= stamp;
  assert.equal(stamp, fingerprint, `${file}: mixed build generations`);
  if (code.includes('webpackJsonp') && file !== 'runtime.js') {
    const wx = { webpackJsonp: { push: chunk => Object.assign(factories, chunk[1]) } };
    vm.runInNewContext(code, { wx, require() {}, App() {}, Page() {}, Component() {} }, { filename: file });
  }
}
// Check actual emitted export names, including minified React component imports.
const modules = new Map(Object.entries(factories).map(([id, factory]) => {
  const ast = parse(`(${factory.toString()})`);
  return [id, { ast, outer: ast.program.body[0].expression, exports: new Set() }];
}));
for (const module of modules.values()) {
  const requireName = module.outer.params[2]?.name;
  traverse(module.ast, { CallExpression(path) {
    const { callee, arguments: args } = path.node;
    if (callee.type === 'MemberExpression' && callee.object.name === requireName && callee.property.name === 'd' && args[1]?.type === 'ObjectExpression')
      for (const prop of args[1].properties) if (prop.key) module.exports.add(prop.key.name ?? prop.key.value);
  } });
}
let componentImports = 0;
// Register real emitted factories without executing native APIs or UI code.
for (const [id, { ast, outer }] of modules) {
  const argument = outer.params[2]?.name;
  if (!argument) continue;
  let binding;
  traverse(ast, {
    FunctionExpression(path) { if (path.node === outer) binding = path.scope.getBinding(argument); },
    CallExpression(path) {
      const { callee, arguments: args } = path.node;
      const jsx = callee.type === 'SequenceExpression' ? callee.expressions.at(-1) : callee;
      const component = args[0];
      if (jsx?.type === 'MemberExpression' && ['jsx', 'jsxs'].includes(jsx.property.name) && component?.type === 'MemberExpression' && !component.computed) {
        const imported = path.scope.getBinding(component.object.name)?.path.node;
        const call = imported?.type === 'VariableDeclarator' ? imported.init : null;
        if (call?.type === 'CallExpression' && call.callee.name === argument && call.arguments[0]?.type === 'NumericLiteral') {
          const target = modules.get(String(call.arguments[0].value));
          if (target?.exports.size) {
            assert.ok(target.exports.has(component.property.name), `Module ${id}: undefined JSX component import ${call.arguments[0].value}.${component.property.name}`);
            componentImports++;
          }
        }
      }
      if (callee.type !== 'Identifier' || callee.name !== argument || args[0]?.type !== 'NumericLiteral' || path.scope.getBinding(argument) !== binding) return;
      assert.ok(factories[args[0].value], `Module ${id} references missing module ${args[0].value}`);
    },
  });
}
for (const marker of ['spot', 'sighting', 'sensitive', 'track'])
  assert.ok(fs.existsSync(path.join(root, `assets/wildlife/marker-${marker}.png`)), `Missing marker icon: ${marker}`);
// 物种头像（档案页用，`presentation/theme/speciesIcons.ts` 引用）。少一张不会报错，
// 只会让档案页那一行悄悄退化成首字占位 —— 因此在构建产物里也断言一次。
for (const species of ['cat', 'swan', 'bird'])
  assert.ok(fs.existsSync(path.join(root, `assets/wildlife/species-${species}.png`)), `Missing species icon: ${species}`);
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
// 页面路由既可能在主包（`app.pages`），也可能在分包（`app.subPackages[].pages`）。
// wildlife 三页都在分包里 —— 只看 `app.pages` 会漏判，这里合并后再断言。
const subpackages = app.subPackages ?? [];
const subpackageRoots = subpackages.map(entry => `${entry.root}/`);
const allPages = [
  ...app.pages,
  ...subpackages.flatMap(entry => entry.pages.map(page => `${entry.root}/${page}`)),
];
assert.ok(allPages.includes('presentation/pages/wildlife/map/index'));
assert.ok(allPages.includes('presentation/pages/wildlife/archive/index'));
assert.ok(app.pages.includes('presentation/pages/home/services/index'));
assert.ok(app.pages.includes('presentation/pages/profile/home/index'));
assert.ok(app.pages.includes('presentation/pages/cou/index'));
assert.ok(app.permission['scope.userLocation']);
for (const page of allPages) {
  assert.ok(!page.endsWith('.html'), `Invalid WeChat page route: ${page}`);
  // wxss is optional: Taro extracts shared page styling into common.wxss.
  for (const extension of ['.js', '.json', '.wxml'])
    assert.ok(fs.existsSync(path.join(root, `${page}${extension}`)), `Incomplete page: ${page}${extension}`);
}
for (const tab of app.tabBar.list) assert.ok(app.pages.includes(tab.pagePath), `Missing tab route: ${tab.pagePath}`);
const project = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
assert.equal(project.setting.compileHotReLoad, false);
assert.equal(project.setting.useApiHook, false);
// 校园底图：它在 **wildlife 分包**里（1 MB 级资源，放主包会顶穿 2 MiB 上限）。
// 这条断言的价值在于：`config/index.ts` 的 copy 规则一旦被改错，底图会静默 404，
// 用户看到的是「一片空白的地图」而不是构建失败。
assert.ok(
  fs.existsSync(path.join(root, 'presentation/pages/wildlife/assets/campus.jpg')),
  'Missing campus basemap: presentation/pages/wildlife/assets/campus.jpg',
);
// 贴纸簿素材（`src/assets/campus`，主包）：`KdyDock` / `CampusChrome` /
// `KdyFeatureArtwork` / 首页地图卡都用**字符串路径**（`/assets/campus/*`）引用，
// 而不是 `import` —— 所以 webpack 不会为它们产出任何 chunk，**只能靠 copy 规则**。
// 这类资源漏拷时构建、单测、verify 全都不报错，真机上只是图片空白（最坏的一种 bug），
// 所以在这里点名列断言；清单变了要一起改。
const CAMPUS_ASSETS = [
  'dock-sketch-frame.svg',
  'sketch-home.svg',
  'sketch-map.svg',
  'sketch-create.svg',
  'sketch-discover.svg',
  'sketch-profile.svg',
  'duck.png',
  'arrow.svg',
  'bag.png',
  'paw.png',
  'map-preview.webp',
];
for (const asset of CAMPUS_ASSETS)
  assert.ok(
    fs.existsSync(path.join(root, `assets/campus/${asset}`)),
    `Missing campus sticker asset: assets/campus/${asset}（检查 config/index.ts 的 copy 规则）`,
  );
// 自定义 tabBar（手绘 dock）**必须有自己的一份 wxss**。
//
// 微信自定义组件默认样式隔离：app.wxss / 页面 wxss 里的 class 选择器对组件内节点
// 无效，而 `custom-tab-bar` 不是页面、不会 import `common.wxss`。少这一份样式时，
// 组件照样渲染，只是「完全没样式」—— `<image>` 退回默认 320×240，真机上是一屏被
// 巨大图标压住的主页面（构建、单测、其余 verify 断言全绿）。所以在这里点住它。
const customTabBarWxss = path.join(root, 'custom-tab-bar/index.wxss');
assert.ok(
  fs.existsSync(customTabBarWxss),
  'Missing custom-tab-bar/index.wxss：dock 会以「无样式」渲染（漏 import ./index.scss？）',
);
assert.ok(
  fs.readFileSync(customTabBarWxss, 'utf8').includes('kdy-dock'),
  'custom-tab-bar/index.wxss 里没有 .kdy-dock 规则：dock 会以「无样式」渲染',
);
// 微信**主包**上限 2 MiB：只统计主包（排除分包根目录下的文件）。
// 早先的实现把整份 dist 当主包统计，分包一多必然误报（分包天然属于"总包 20 MiB"那一档）。
const bytes = fs
  .readdirSync(root, { recursive: true })
  .map(name => String(name).split(path.sep).join('/'))
  .filter(name => !subpackageRoots.some(prefix => name.startsWith(prefix)))
  .reduce((sum, name) => {
    const stat = fs.statSync(path.join(root, name)); return sum + (stat.isFile() ? stat.size : 0);
  }, 0);
assert.ok(bytes < 2 * 1024 * 1024, `Main package exceeds 2 MiB: ${bytes}`);
// 微信**单个分包**上限也是 2 MiB。校园底图进了分包，所以这条必须一起守：
// 以后往 wildlife 分包里再塞资源时，超了要在这里就红，而不是等上传被拒。
const wildlifeRoot = 'presentation/pages/wildlife/';
const wildlifeBytes = fs
  .readdirSync(root, { recursive: true })
  .map(name => String(name).split(path.sep).join('/'))
  .filter(name => name.startsWith(wildlifeRoot))
  .reduce((sum, name) => {
    const stat = fs.statSync(path.join(root, name)); return sum + (stat.isFile() ? stat.size : 0);
  }, 0);
assert.ok(wildlifeBytes < 2 * 1024 * 1024, `Wildlife subpackage exceeds 2 MiB: ${wildlifeBytes}`);
console.log(`WeChat build verified: ${Object.keys(factories).length} module factories, ${componentImports} JSX imports, coherent chunks, no temporary diagnostics, main package ${(bytes / 1024 / 1024).toFixed(2)} MiB (excludes ${subpackageRoots.length} subpackages), wildlife subpackage ${(wildlifeBytes / 1024 / 1024).toFixed(2)} MiB.`);
