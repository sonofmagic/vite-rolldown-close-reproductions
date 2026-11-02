import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { setImmediate as nextTask } from 'node:timers/promises'
import { createServer } from 'vite'
import { versions } from './versions.mjs'

const observations = []
const fixtures = path.join(import.meta.dirname, 'fixtures')
await mkdir(fixtures, { recursive: true })
console.log(JSON.stringify(await versions()))

async function reproduce(requestsIdleFirst) {
  const root = await mkdtemp(path.join(fixtures, 'optimizer-'))
  const cacheDir = path.join(root, 'cache')
  const entered = Promise.withResolvers()
  const release = Promise.withResolvers()
  let server
  let closing
  try {
    await writeFile(path.join(root, 'package.json'), '{"type":"module"}')
    await writeFile(path.join(root, 'entry.js'), 'export const answer = 42')
    server = await createServer({
      root,
      configFile: false,
      cacheDir,
      server: { middlewareMode: true, hmr: false, ws: false, watch: null },
      optimizeDeps: {
        entries: ['entry.js'],
        rolldownOptions: { plugins: [{
          name: 'hold-real-scanner',
          async buildStart() {
            entered.resolve()
            await release.promise
          },
        }] },
      },
    })
    await entered.promise
    if (requestsIdleFirst) {
      await server.environments.client.waitForRequestsIdle()
    }
    let closed = false
    closing = server.close().finally(() => {
      closed = true
    })
    // Observe the original close while the real scanner hook remains in flight.
    await nextTask()
    assert.equal(closed, false, 'Close should still be waiting for the scanner')
    release.resolve()
    await closing
    const cacheEntries = await readdir(cacheDir).catch((error) => {
      if (error.code === 'ENOENT') {
        return []
      }
      throw error
    })
    const observation = { requestsIdleFirst, closeWaitedForScanner: true, cacheEntries }
    observations.push(observation)
    console.log(JSON.stringify(observation))
  }
  finally {
    release.resolve()
    await closing
    await server?.close()
    // Preserve this test-owned cache for inspection after natural process exit.
  }
}

const watchdog = setTimeout(() => {
  throw new Error('Reproduction timed out after 30 seconds')
}, 30_000)
try {
  await reproduce(false)
  await reproduce(true)
  await mkdir(path.join(import.meta.dirname, 'artifacts'), { recursive: true })
  await writeFile(new URL('./artifacts/optimizer.json', import.meta.url), `${JSON.stringify(observations, null, 2)}\n`)
  assert.deepEqual(observations.map(item => item.cacheEntries.filter(name => name.startsWith('deps_temp_'))), [[], []], 'Cancelled scans left temporary optimizer caches after server.close()')
}
catch (error) {
  process.exitCode = 1
  console.error(error)
}
finally {
  clearTimeout(watchdog)
}
