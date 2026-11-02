import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { setImmediate as nextTask } from 'node:timers/promises'
import { getHeapStatistics, writeHeapSnapshot } from 'node:v8'
import { versions } from './versions.mjs'

assert.equal(typeof globalThis.gc, 'function', 'Use node --expose-gc')
const engine = process.argv[2]
assert.ok(['vite', 'rolldown'].includes(engine), 'Choose vite or rolldown')
const rolldown = engine === 'rolldown' ? (await import('rolldown')).rolldown : undefined
const build = engine === 'vite' ? (await import('vite')).build : undefined
const references = []
const samples = []
const rounds = 16
let completedCloses = 0

function unretainedControl() {
  const marker = { tag: 'control-only-weakref' }
  return new WeakRef(marker)
}
const control = unretainedControl()

async function collect() {
  for (let pass = 0; pass < 8; pass++) {
    await nextTask()
    globalThis.gc()
  }
  await nextTask()
}

async function round(root, index) {
  const marker = { tag: `closed-build-${index}` }
  references.push(new WeakRef(marker))
  const options = {
    input: path.join(root, 'entry.js'),
    logLevel: 'silent',
    onLog(level, log, defaultHandler) {
      assert.ok(marker.tag)
      defaultHandler(level, log)
    },
  }
  if (engine === 'rolldown') {
    const bundle = await rolldown(options)
    try {
      const result = await bundle.generate({ format: 'es' })
      assert.ok(result.output.some(item => item.type === 'chunk' && item.code.includes('results')))
    }
    finally {
      await bundle.close()
    }
    assert.equal(bundle.closed, true)
    completedCloses++
  }
  else {
    const result = await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [{
        name: 'closed-build-marker',
        closeBundle() {
          assert.ok(marker.tag)
          completedCloses++
        },
      }],
      build: { write: false, minify: false, rolldownOptions: { input: options.input, output: { format: 'es' } } },
    })
    assert.ok(result.output.some(item => item.type === 'chunk' && item.code.includes('results')))
  }
}

await mkdir(new URL('./fixtures/', import.meta.url), { recursive: true })
await mkdir(new URL('./artifacts/', import.meta.url), { recursive: true })
const root = await mkdtemp(new URL('./fixtures/closed-', import.meta.url))
await mkdir(path.join(root, 'modules'))
await writeFile(path.join(root, 'package.json'), '{"type":"module"}')
const imports = []
for (let index = 0; index < 64; index++) {
  await writeFile(path.join(root, 'modules', `${index}.js`), `export const value = ${index}`)
  imports.push(`import { value as v${index} } from './modules/${index}.js'`)
}
await writeFile(path.join(root, 'entry.js'), `${imports.join('\n')}\nconsole.log('results', [${imports.map((_, index) => `v${index}`).join(',')}])`)
const environment = await versions()
console.log(JSON.stringify({ engine, rounds, ...environment }))
for (let index = 0; index < rounds; index++) {
  await round(root, index)
  await collect()
  const sample = { round: index + 1, ...process.memoryUsage(), globalHandlesBytes: getHeapStatistics().used_global_handles_size }
  samples.push(sample)
  console.log(JSON.stringify(sample))
}
await collect()
assert.equal(completedCloses, rounds, 'Every build must complete its close lifecycle')
// Do not dereference weak references during the earlier GC turns.
const retained = references.flatMap((ref, index) => ref.deref() ? [index] : [])
const controlAlive = Boolean(control.deref())
const report = { engine, rounds, completedCloses, ...environment, controlAlive, retained, samples }
await writeFile(new URL(`./artifacts/${engine}-retention.json`, import.meta.url), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ engine, completedCloses, controlAlive, retained }))
if (process.argv.includes('--snapshot')) {
  await collect()
  writeHeapSnapshot(path.join(import.meta.dirname, 'artifacts', `${engine}-closed.heapsnapshot`))
}
assert.equal(controlAlive, false, 'The independent weak-only control must be collectible')
assert.deepEqual(retained, [], 'Completed builds still retain the callback or plugin closure markers')
