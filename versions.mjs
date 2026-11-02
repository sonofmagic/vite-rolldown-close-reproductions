import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'

export async function versions() {
  const require = createRequire(import.meta.url)
  const viteFile = require.resolve('vite/package.json')
  const rolldownFile = require.resolve('rolldown/package.json')
  assert.equal(createRequire(viteFile).resolve('rolldown/package.json'), rolldownFile)
  const packages = {}
  for (const [name, file] of [['vite', viteFile], ['rolldown', rolldownFile]]) {
    const manifest = JSON.parse(await readFile(file, 'utf8'))
    const source = path.relative(import.meta.dirname, file).split(path.sep).join('/')
    assert.ok(source.startsWith('node_modules/'), 'Use the reproduction-local npm installation')
    packages[name] = { version: manifest.version, source }
  }
  return { node: process.version, platform: process.platform, arch: process.arch, packages }
}
