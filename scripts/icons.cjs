// Generates the app icon, Android launcher/splash images and PWA icons from one design.
// Usage: node scripts/icons.cjs
const fs = require('fs')
const path = require('path')
const opentype = require('opentype.js')
let sharp
try { sharp = require('sharp') } catch { sharp = require('/opt/npm-tools/node_modules/sharp') }

const root = path.join(__dirname, '..')
const INK = '#1b2232'
const PAPER = '#f4f5f2'
const RUBRIC = '#d2564b'

const buf = fs.readFileSync(path.join(root, 'node_modules/@fontsource/markazi-text/files/markazi-text-arabic-700-normal.woff'))
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
const glyphPath = font.getPath('ق', 0, 0, 100)
const bb = glyphPath.getBoundingBox()
const d = glyphPath.toPathData(3)

/** The mark: glyph centred in a box of `size`, with the margin rule on the right. */
function mark(size, { glyphScale = 0.5, lineX = 0.74, lineTop = 0.24, lineBottom = 0.76, color = PAPER } = {}) {
  const gw = bb.x2 - bb.x1
  const gh = bb.y2 - bb.y1
  const s = (size * glyphScale) / Math.max(gw, gh)
  const cx = size * 0.47
  const cy = size * 0.5
  const tx = cx - (bb.x1 + gw / 2) * s
  const ty = cy - (bb.y1 + gh / 2) * s
  const lw = Math.max(1.5, size * 0.022)
  return `<path d="${d}" fill="${color}" transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${s.toFixed(4)})"/>
  <rect x="${(size * lineX).toFixed(2)}" y="${(size * lineTop).toFixed(2)}" width="${lw.toFixed(2)}" height="${(size * (lineBottom - lineTop)).toFixed(2)}" rx="${(lw / 2).toFixed(2)}" fill="${RUBRIC}"/>`
}

function squareIcon(size, radius = 0.22) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${size * radius}" fill="${INK}"/>
  ${mark(size)}
</svg>`
}

function fullBleed(size, glyphScale = 0.4) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${INK}"/>
  ${mark(size, { glyphScale, lineX: 0.7, lineTop: 0.3, lineBottom: 0.7 })}
</svg>`
}

function foreground(size) {
  // Adaptive icon foreground: transparent, artwork inside the 66/108 safe zone
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${mark(size, { glyphScale: 0.38, lineX: 0.69, lineTop: 0.31, lineBottom: 0.69 })}
</svg>`
}

function roundIcon(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${INK}"/>
  ${mark(size, { glyphScale: 0.44, lineX: 0.72, lineTop: 0.27, lineBottom: 0.73 })}
</svg>`
}

function splash(w, h) {
  const s = Math.min(w, h) * 0.28
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${PAPER}"/>
  <g transform="translate(${(w - s) / 2} ${(h - s) / 2})">
    <rect width="${s}" height="${s}" rx="${s * 0.22}" fill="${INK}"/>
    ${mark(s)}
  </g>
</svg>`
}

async function png(svg, out) {
  fs.mkdirSync(path.dirname(out), { recursive: true })
  await sharp(Buffer.from(svg)).png().toFile(out)
}

;(async () => {
  const res = path.join(root, 'android/app/src/main/res')
  const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
  for (const [k, f] of Object.entries(dens)) {
    await png(squareIcon(Math.round(48 * f)), `${res}/mipmap-${k}/ic_launcher.png`)
    await png(roundIcon(Math.round(48 * f)), `${res}/mipmap-${k}/ic_launcher_round.png`)
    await png(foreground(Math.round(108 * f)), `${res}/mipmap-${k}/ic_launcher_foreground.png`)
  }
  // legacy splash images (Android < 12)
  const splashes = {
    'drawable': [480, 320],
    'drawable-port-mdpi': [320, 480], 'drawable-port-hdpi': [480, 800], 'drawable-port-xhdpi': [720, 1280], 'drawable-port-xxhdpi': [960, 1600], 'drawable-port-xxxhdpi': [1280, 1920],
    'drawable-land-mdpi': [480, 320], 'drawable-land-hdpi': [800, 480], 'drawable-land-xhdpi': [1280, 720], 'drawable-land-xxhdpi': [1600, 960], 'drawable-land-xxxhdpi': [1920, 1280],
  }
  for (const [dir, [w, h]] of Object.entries(splashes)) await png(splash(w, h), `${res}/${dir}/splash.png`)

  const pub = path.join(root, 'public')
  fs.writeFileSync(`${pub}/favicon.svg`, squareIcon(64))
  await png(squareIcon(192), `${pub}/icon-192.png`)
  await png(squareIcon(512), `${pub}/icon-512.png`)
  await png(fullBleed(512), `${pub}/icon-maskable-512.png`)
  await png(fullBleed(180, 0.46), `${pub}/apple-touch-icon.png`)
  await png(squareIcon(1024), path.join(root, 'scripts/icon-1024.png'))
  console.log('icons written')
})()
