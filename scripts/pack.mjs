/**
 * Pack the plugin into an installable tarball.
 *
 * A `.tgz` whose root is `package/` is exactly what `dsh plugin add` expects, so
 * this avoids depending on npm's pack pipeline (and its .npmignore semantics).
 *
 * Run: node scripts/pack.mjs
 */

import { mkdir, readFile, readdir, rm, writeFile, cp } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { gzipSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const stage = join(root, '.pack', 'package')
const outDir = join(root, 'release')
const outFile = join(outDir, `${manifest.name}-${manifest.version}.tgz`)

await rm(join(root, '.pack'), { recursive: true, force: true })
await mkdir(stage, { recursive: true })

// `files` in package.json is the single source of truth for what ships, plus the
// manifest itself: npm always includes package.json, and the plugin loader needs
// it to read the `dsh` block.
const entries = ['package.json', ...manifest.files]
for (const entry of entries) {
  const source = join(root, entry)
  const target = join(stage, entry)
  try {
    await mkdir(dirname(target), { recursive: true })
    await cp(source, target)
  } catch (error) {
    throw new Error(`package.json "files" lists ${entry}, but it could not be staged: ${error.message}`)
  }
}

//#region ustar writer

/** A minimal POSIX ustar writer: no dependency on tar or npm. */
function tarEntry(name, content, mode = 0o644) {
  const header = Buffer.alloc(512)
  const write = (value, offset, length) => {
    header.write(String(value).slice(0, length), offset, length, 'utf8')
  }
  const numeric = (value, offset, length) => {
    const text = value.toString(8).padStart(length - 1, '0')
    header.write(text, offset, length - 1, 'ascii')
    header[offset + length - 1] = 0
  }
  write(name, 0, 100)
  numeric(mode, 100, 8)
  numeric(0, 108, 8)
  numeric(0, 116, 8)
  numeric(content.length, 124, 12)
  numeric(Math.floor(Date.now() / 1000), 136, 12)
  header.write('        ', 148, 8, 'ascii') // checksum placeholder
  header[156] = '0'.charCodeAt(0)
  header.write('ustar\0', 257, 6, 'ascii')
  header.write('00', 263, 2, 'ascii')

  let checksum = 0
  for (const byte of header) checksum += byte
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii')

  const padding = content.length % 512 === 0 ? 0 : 512 - (content.length % 512)
  return [header, content, Buffer.alloc(padding)]
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(full)))
    else files.push(full)
  }
  return files
}

//#endregion

const files = (await walk(stage)).sort()
const chunks = []
for (const file of files) {
  const name = relative(join(root, '.pack'), file).split('\\').join('/')
  chunks.push(...tarEntry(name, await readFile(file)))
}
chunks.push(Buffer.alloc(1024)) // two empty blocks terminate the archive

await mkdir(outDir, { recursive: true })
await writeFile(outFile, gzipSync(Buffer.concat(chunks), { level: 9 }))
await rm(join(root, '.pack'), { recursive: true, force: true })

const { size } = await import('node:fs/promises').then((fs) => fs.stat(outFile))
console.log(`packed ${files.length} files -> ${relative(root, outFile)} (${(size / 1024).toFixed(1)} KB)`)
for (const file of files) {
  console.log(`  ${relative(join(root, '.pack'), file).split('\\').join('/')}`)
}
