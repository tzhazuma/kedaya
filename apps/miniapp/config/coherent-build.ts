import { createHash } from 'node:crypto'
import type { Compiler } from 'webpack'

/** Notify the WeChat file cache when shared module IDs change in another chunk. */
export class CoherentBuildPlugin {
  apply(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap('KedayaCoherentBuild', compilation => {
      compilation.hooks.processAssets.tap({
        name: 'KedayaCoherentBuild',
        stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT + 100,
      }, () => {
        const scripts = compilation.getAssets().filter(asset => asset.name.endsWith('.js'))
          .sort((a, b) => a.name.localeCompare(b.name))
        const hash = createHash('sha256')
        for (const asset of scripts) hash.update(asset.name).update(asset.source.buffer())
        const stamp = `\n// kedaya-build:${hash.digest('hex').slice(0, 20)}\n`
        for (const asset of scripts) compilation.updateAsset(asset.name,
          new compiler.webpack.sources.ConcatSource(asset.source, stamp))
      })
    })
  }
}
