module.exports = ctx => {
  if (process.env.KEDAYA_WEAPP_STAGE !== '1') return;
  ctx.onBuildFinish(({ error, stats }) => {
    if (error || stats?.hasErrors()) return;
    require('./publish-weapp.cjs').publishWeapp();
  });
};
