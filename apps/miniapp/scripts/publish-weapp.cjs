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
function publishWeapp(options = {}) {
  const root = path.resolve(options.root ?? defaultRoot);
  const stage = managedPath(root, '.weapp-stage'), next = managedPath(root, '.weapp-next');
  const live = managedPath(root, 'dist'), backup = managedPath(root, '.weapp-last-good');
  // Validate before disturbing the last usable version, including on watch builds.
  if (options.verify) options.verify(stage);
  else execFileSync(process.execPath, [path.join(__dirname, 'verify-weapp-build.cjs'), stage], { cwd: root, stdio: 'inherit' });
  removeManaged(root, next);
  fs.mkdirSync(next);
  fs.writeFileSync(path.join(next, '.kedaya-build.json'), JSON.stringify({ owner, builtAt: new Date().toISOString() }));
  fs.cpSync(stage, next, { recursive: true });
  const project = JSON.parse(fs.readFileSync(path.join(next, 'project.config.json'), 'utf8'));
  project.miniprogramRoot = './'; project.srcMiniprogramRoot = './';
  fs.writeFileSync(path.join(next, 'project.config.json'), JSON.stringify(project, null, 2));
  removeManaged(root, backup);
  let saved = false;
  try {
    if (fs.existsSync(live)) {
      // Keep one recoverable previous package; never clear the live directory first.
      fs.renameSync(live, backup); saved = true;
      fs.writeFileSync(path.join(backup, '.kedaya-build.json'), JSON.stringify({ owner }));
    }
    fs.renameSync(next, live);
  } catch (error) {
    if (saved && !fs.existsSync(live)) fs.renameSync(backup, live);
    throw error;
  }
  console.log('小程序完整包已发布到 dist；上一版保留在 .weapp-last-good。');
}
module.exports = { publishWeapp };
