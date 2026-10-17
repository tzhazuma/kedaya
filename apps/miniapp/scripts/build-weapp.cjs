// Build outside the live IDE directory; publish only a complete validated package.
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const lock = path.join(root, '.weapp-build.lock');
const watch = process.argv.includes('--watch');
function release() {
  try { if (JSON.parse(fs.readFileSync(lock, 'utf8')).pid === process.pid) fs.unlinkSync(lock); } catch {}
}
try {
  try { const previous = JSON.parse(fs.readFileSync(lock, 'utf8')); process.kill(previous.pid, 0); throw new Error(`已有小程序构建在运行（PID ${previous.pid}），请先结束该构建。`); }
  catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error; if (error.code === 'ESRCH') fs.unlinkSync(lock); }
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid }), { flag: 'wx' });
  process.on('exit', release);
  const tokens = spawnSync(process.execPath, [path.join(__dirname, 'generate-tokens-scss.mjs')], { cwd: root, stdio: 'inherit' });
  if (tokens.status !== 0) process.exit(tokens.status || 1);
  const cli = path.join(path.dirname(require.resolve('@tarojs/cli/package.json')), 'bin/taro');
  const child = spawn(process.execPath, [cli, 'build', '--type', 'weapp', ...(watch ? ['--watch'] : [])], {
    cwd: root, stdio: 'inherit', env: { ...process.env, KEDAYA_WEAPP_STAGE: '1' },
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('error', error => { console.error(error); process.exitCode = 1; release(); });
  child.on('exit', code => { release(); process.exitCode = code ?? 1; });
} catch (error) { console.error(error.message); process.exitCode = 1; }
