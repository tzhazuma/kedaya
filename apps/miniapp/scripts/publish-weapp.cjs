const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const defaultRoot = path.resolve(__dirname, '..');
const owner = 'kedaya-weapp-publisher';
function managedPath(root, name) {
  if (!['.weapp-stage', '.weapp-next', '.weapp-last-good', 'dist'].includes(name)) throw Error('Invalid build directory');
  const result = path.resolve(root, name);
  if (path.dirname(result) !== root) throw Error('Build path escaped miniapp workspace');
  return result;
}
function removeManaged(root, directory) {
  if (!fs.existsSync(directory)) return;
  const marker = JSON.parse(fs.readFileSync(path.join(directory, '.kedaya-build.json'), 'utf8'));
  if (marker.owner !== owner || !['.weapp-next', '.weapp-last-good'].includes(path.basename(directory)) || path.dirname(directory) !== root)
    throw Error(`Refusing to remove an unmanaged directory: ${directory}`);
  fs.rmSync(directory, { recursive: true });
}

/** 递归列出相对路径（构建产物里没有软链接，直接按文件系统遍历即可） */
function listFiles(directory, base = directory, acc = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) listFiles(absolute, base, acc);
    else acc.push(path.relative(base, absolute));
  }
  return acc;
}
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
/**
 * 覆盖单个文件。
 *
 * 发布是**原地**写进 `dist/`（微信开发者工具正在监视这个目录），
 * 而工具会短暂持有这些文件的读句柄，Windows 上偶发 EBUSY/EPERM —— 稍等重试即可。
 */
function copyFileWithRetry(from, to) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.copyFileSync(from, to);
      return;
    } catch (error) {
      if (attempt >= 5 || !['EBUSY', 'EPERM', 'EACCES', 'EMFILE'].includes(error.code)) throw error;
      sleepSync(60);
    }
  }
}
function copyTree(from, to) {
  for (const relative of listFiles(from)) {
    const source = path.join(from, relative);
    const target = path.join(to, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    copyFileWithRetry(source, target);
  }
}
/** 删掉 `live` 里已经不属于本次构建的文件，再清掉空目录（否则旧的哈希 chunk 会永久堆积） */
function pruneExtras(live, expectedFiles) {
  const expected = new Set(expectedFiles);
  for (const relative of listFiles(live)) {
    if (!expected.has(relative)) fs.rmSync(path.join(live, relative), { force: true });
  }
  const dirs = [];
  (function collect(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const absolute = path.join(directory, entry.name);
      collect(absolute);
      dirs.push(absolute);
    }
  })(live);
  for (const directory of dirs) if (fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
}

/**
 * 把 `.weapp-stage/` 的校验结果发布到 `dist/`。
 *
 * ⚠️ **原地同步，不替换 `dist/` 目录本身。**
 * 早先的实现是 `dist → .weapp-last-good`、`.weapp-next → dist` 两次改名，
 * 虽然换包是原子的，但微信开发者工具的文件监视是按目录句柄挂的：
 * 目录被改名后它再也看不到新 `dist/` 里的文件（日志表现为只有 `unlinkDir dist`、
 * 没有后续 `add dist/app.json`），于是编译一直报「在该目录下未找到 app.json」，
 * 必须清缓存/重开项目才能恢复。原地写文件则退化成普通的增删改事件，工具能正常跟随。
 */
function publishWeapp(options = {}) {
  const root = path.resolve(options.root ?? defaultRoot);
  const stage = managedPath(root, '.weapp-stage'), next = managedPath(root, '.weapp-next');
  const live = managedPath(root, 'dist'), backup = managedPath(root, '.weapp-last-good');
  // Validate before touching the live directory, including on watch builds.
  if (options.verify) options.verify(stage);
  else execFileSync(process.execPath, [path.join(__dirname, 'verify-weapp-build.cjs'), stage], { cwd: root, stdio: 'inherit' });

  // 1. 备份当前线上包（复制，不是改名：dist 目录身份必须保持不变）
  removeManaged(root, backup);
  if (fs.existsSync(live)) {
    fs.mkdirSync(backup, { recursive: true });
    copyTree(live, backup);
    fs.writeFileSync(path.join(backup, '.kedaya-build.json'), JSON.stringify({ owner }));
  }

  // 2. 在 .weapp-next 里准备发布副本：包内的 project.config.json 指向包根
  removeManaged(root, next);
  fs.mkdirSync(next, { recursive: true });
  fs.writeFileSync(path.join(next, '.kedaya-build.json'), JSON.stringify({ owner, builtAt: new Date().toISOString() }));
  fs.cpSync(stage, next, { recursive: true });
  const project = JSON.parse(fs.readFileSync(path.join(next, 'project.config.json'), 'utf8'));
  project.miniprogramRoot = './'; project.srcMiniprogramRoot = './';
  fs.writeFileSync(path.join(next, 'project.config.json'), JSON.stringify(project, null, 2));

  // 3. 原地同步进 dist（先写文件，再按本次清单删多余文件）
  const expected = listFiles(next);
  try {
    fs.mkdirSync(live, { recursive: true });
    copyTree(next, live);
    pruneExtras(live, expected);
  } catch (error) {
    // 回滚：用备份原地覆盖回去（同样不删 dist 目录）
    if (fs.existsSync(backup)) {
      try {
        copyTree(backup, live);
        pruneExtras(live, listFiles(backup));
      } catch {}
    }
    throw error;
  }
  console.log('小程序完整包已原地发布到 dist（上一版备份在 .weapp-last-good）。');
}
module.exports = { publishWeapp };
