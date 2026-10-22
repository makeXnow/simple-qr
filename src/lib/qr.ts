import qrcode from 'qrcode-generator'
import type opentype from 'opentype.js'
import type { ResolvedColor } from './color'
import { frameGeometry, type FrameGeometry, type FrameShape } from './frames'

export type PointStyle = 'square' | 'rounded' | 'circle'
export type CornerStyle = 'square' | 'rounded' | 'circle'

export const POINT_STYLES: { value: PointStyle; label: string }[] = [
  { value: 'square', label: 'Squares' },
  { value: 'rounded', label: 'Rounded squares' },
  { value: 'circle', label: 'Circles' },
]

export const CORNER_STYLES: { value: CornerStyle; label: string }[] = [
  { value: 'square', label: 'Square corners' },
  { value: 'rounded', label: 'Rounded corners' },
  { value: 'circle', label: 'Circle corners' },
]

export interface QrRenderOptions {
  data: string
  points: PointStyle
  /** Style of the three big finder patterns. */
  corners: CornerStyle
  frame: FrameShape
  /** 1–100. Raises fill odds for cells the frame outline cuts through and lowers the coverage cutoff. */
  edgeDefinition: number
  /** 0–3 extra layers of cells the frame outline is pushed out by. */
  edgeThickness: number
  color: ResolvedColor
  displayText: string
  font: opentype.Font | null
  fontSize: number
  textDistance: number
}

// The QR itself always occupies a fixed 200x200 box in SVG units.
const QR_SIZE = 200
const QR_HALF = QR_SIZE / 2
const PADDING = 32
// Canvas is drawn at 8x so it stays crisp when CSS scales it to fit the preview.
const CANVAS_SCALE = 8
const COVERAGE_SAMPLES = 12
const SHOW_FRAME_GUIDE = false
const FRAME_GUIDE_COLOR = 'rgba(239, 68, 68, 0.5)'
// [inset, size] in modules for the finder's outer ring, hole, and center.
const FINDER_LAYERS = [
  [0, 7],
  [1, 5],
  [2, 3],
] as const
// Corner radius of each point style, in modules.
const CIRCLE_POINT_RADIUS = 0.45
const ROUNDED_POINT_RADIUS = 0.3
// M recovers ~15% damage, leaving headroom for styled points and the frame filler.
const ERROR_CORRECTION = 'M'

/** Draws the QR onto the canvas and returns the matching vector SVG. */
export function renderQr(canvas: HTMLCanvasElement, opts: QrRenderOptions): string {
  const { points, frame, color, displayText, font, fontSize, textDistance } = opts
  const hasText = displayText.trim() !== ''
  const rgbaColor = `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a})`

  const qr = qrcode(0, ERROR_CORRECTION)
  qr.addData(opts.data || ' ')
  qr.make()

  const count = qr.getModuleCount()
  const cellSize = QR_SIZE / count
  const geo: FrameGeometry | null = frame === 'square' ? null : frameGeometry(frame, count, opts.edgeThickness)
  const figureWidth = geo ? (geo.maxX - geo.minX) * QR_HALF : QR_SIZE
  const figureHeight = geo ? (geo.maxY - geo.minY) * QR_HALF : QR_SIZE

  const textWidth = hasText && font ? font.getAdvanceWidth(displayText, fontSize) : 0
  const contentWidth = Math.max(figureWidth, textWidth)
  const totalWidth = contentWidth + PADDING * 2

  let contentHeight = figureHeight
  if (hasText) {
    // Extra 0.4em keeps descenders (g, j, p, q, y) from clipping.
    contentHeight += textDistance + fontSize + fontSize * 0.4
  }
  const totalHeight = contentHeight + PADDING * 2

  const figureX = PADDING + (contentWidth - figureWidth) / 2
  const figureY = PADDING
  const qrCenterX = figureX + (geo ? -geo.minX * QR_HALF : QR_HALF)
  const qrCenterY = figureY + (geo ? -geo.minY * QR_HALF : QR_HALF)
  const qrOffsetX = qrCenterX - QR_HALF
  const qrOffsetY = qrCenterY - QR_HALF

  canvas.width = totalWidth * CANVAS_SCALE
  canvas.height = totalHeight * CANVAS_SCALE
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.scale(CANVAS_SCALE, CANVAS_SCALE)

  let pathData = ''
  ctx.fillStyle = rgbaColor
  ctx.beginPath()

  const drawPoint = (row: number, col: number) => {
    const x = qrOffsetX + col * cellSize
    const y = qrOffsetY + row * cellSize

    if (points === 'circle') {
      const radius = cellSize * CIRCLE_POINT_RADIUS
      const cx = x + cellSize / 2
      const cy = y + cellSize / 2
      ctx.moveTo(cx + radius, cy)
      ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      pathData += `M ${cx - radius} ${cy} a ${radius} ${radius} 0 1 0 ${radius * 2} 0 a ${radius} ${radius} 0 1 0 ${-radius * 2} 0 Z `
    } else if (points === 'rounded') {
      const gap = cellSize * 0.05
      addRoundedSquare(x + gap, y + gap, cellSize * 0.9, cellSize * ROUNDED_POINT_RADIUS)
    } else {
      // +0.1 hides hairline antialiasing gaps between adjacent squares on canvas.
      ctx.rect(x, y, cellSize + 0.1, cellSize + 0.1)
      pathData += `M ${x} ${y} h ${cellSize} v ${cellSize} h ${-cellSize} Z `
    }
  }

  const addRoundedSquare = (x: number, y: number, size: number, r: number) => {
    ctx.roundRect(x, y, size, size, r)
    pathData += roundedSquarePath(x, y, size, r)
  }

  // Finder patterns are drawn as solid rings + centers so scanners still see the 1:1:3:1:1 ratio.
  const drawFinder = (row: number, col: number) => {
    const x = qrOffsetX + col * cellSize
    const y = qrOffsetY + row * cellSize
    for (const [ix, iy, size, r] of finderLayers(opts.corners, points, cellSize)) {
      ctx.roundRect(x + ix, y + iy, size, size, r)
    }
    pathData += finderPath(opts.corners, points, cellSize, x, y)
  }

  let darkCount = 0
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (!qr.isDark(row, col)) continue
      darkCount++
      if (inFinder(row, col, count)) continue
      drawPoint(row, col)
    }
  }

  if (geo) {
    const density = darkCount / (count * count)
    const edgeT = (Math.min(100, Math.max(1, opts.edgeDefinition)) - 1) / 99
    const cutoff = 0.5 - 0.1 * edgeT
    // Eased so edges that start near full (e.g. the hexagon's flat sides) don't saturate long before 100.
    const edgeBoost = edgeT * edgeT
    const edgeCells: { row: number; col: number; chance: number; roll: number; angle: number }[] = []
    const random = seededRandom(opts.data)
    const firstCol = Math.floor(((geo.minX + 1) * QR_HALF) / cellSize) - 1
    const lastCol = Math.ceil(((geo.maxX + 1) * QR_HALF) / cellSize)
    const firstRow = Math.floor(((geo.minY + 1) * QR_HALF) / cellSize) - 1
    const lastRow = Math.ceil(((geo.maxY + 1) * QR_HALF) / cellSize)
    const anchorCells = new Set(
      (geo.anchors ?? []).map(([ax, ay]) => {
        const col = Math.floor(((ax + 1) * QR_HALF) / cellSize)
        const row = Math.floor(((ay + 1) * QR_HALF) / cellSize)
        return `${row},${col}`
      }),
    )
    for (let row = firstRow; row <= lastRow; row++) {
      for (let col = firstCol; col <= lastCol; col++) {
        if (row >= 0 && row < count && col >= 0 && col < count) continue
        // Always draw a number so the pattern doesn't shift when unrelated cells change.
        const roll = random()
        if (anchorCells.has(`${row},${col}`)) {
          drawPoint(row, col)
          continue
        }
        if (touchesFinder(row, col, count)) continue
        const x0 = col * cellSize - QR_HALF
        const y0 = row * cellSize - QR_HALF
        const coverage = cellCoverage(geo, x0, y0, cellSize)
        if (coverage < cutoff) continue
        const base = ((coverage - cutoff) / (1 - cutoff)) * density
        const onEdge = coverage < 1 || touchesOutline(geo, x0, y0, cellSize)
        if (onEdge) {
          const angle = Math.atan2(y0 + cellSize / 2, x0 + cellSize / 2)
          edgeCells.push({ row, col, chance: base + (1 - base) * edgeBoost, roll, angle })
        } else if (roll < density) {
          drawPoint(row, col)
        }
      }
    }

    // Walk the outline in order and fill on a running tally (error diffusion) instead of
    // independent coin flips, so gaps spread evenly around the shape rather than clumping.
    // The jittered threshold keeps the spacing from looking mechanical.
    edgeCells.sort((a, b) => a.angle - b.angle)
    let tally = random()
    for (const cell of edgeCells) {
      tally += cell.chance
      if (cell.chance >= 1 || tally >= 0.5 + cell.roll) {
        drawPoint(cell.row, cell.col)
        tally -= 1
      }
    }
  }
  ctx.fill()

  ctx.beginPath()
  for (const [r, c] of finderCorners(count)) drawFinder(r, c)
  ctx.fill('evenodd')

  if (geo && SHOW_FRAME_GUIDE) {
    ctx.beginPath()
    geo.outline.forEach(([x, y], i) => {
      const px = qrCenterX + x * QR_HALF
      const py = qrCenterY + y * QR_HALF
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    })
    ctx.closePath()
    ctx.strokeStyle = FRAME_GUIDE_COLOR
    ctx.lineWidth = 0.5
    ctx.stroke()
  }

  let textSvgPath = ''
  if (hasText && font) {
    const textY = figureY + figureHeight + textDistance + fontSize
    const startX = totalWidth / 2 - font.getAdvanceWidth(displayText, fontSize) / 2
    const textPath = font.getPath(displayText, startX, textY, fontSize)
    textSvgPath = textPath.toPathData(2)
    textPath.fill = rgbaColor
    textPath.draw(ctx)
  }

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="100%" height="100%">`
  svg += `<path d="${pathData}" fill="#${color.hex}" fill-opacity="${color.a}" fill-rule="evenodd" />`
  if (textSvgPath) {
    svg += `<path d="${textSvgPath}" fill="#${color.hex}" fill-opacity="${color.a}" />`
  }
  svg += `</svg>`
  return svg
}

/** Top-left module of each 7x7 finder pattern. */
function finderCorners(count: number): [number, number][] {
  return [
    [0, 0],
    [0, count - 7],
    [count - 7, 0],
  ]
}

function inFinder(row: number, col: number, count: number): boolean {
  return finderCorners(count).some(([r, c]) => row >= r && row < r + 7 && col >= c && col < c + 7)
}

/** True if the cell is within one module (including diagonally) of a 7x7 finder pattern. */
function touchesFinder(row: number, col: number, count: number): boolean {
  return finderCorners(count).some(([r, c]) => row >= r - 1 && row <= r + 7 && col >= c - 1 && col <= c + 7)
}

/**
 * [x offset, y offset, size, corner radius] for each finder layer. Rounded corners use the
 * points' own corner radius so the big squares match the dots.
 */
function finderLayers(corners: CornerStyle, points: PointStyle, cell: number): [number, number, number, number][] {
  const matched = points === 'circle' ? CIRCLE_POINT_RADIUS : ROUNDED_POINT_RADIUS
  return FINDER_LAYERS.map(([inset, modules]) => {
    const size = modules * cell
    const r = corners === 'circle' ? size / 2 : corners === 'rounded' ? matched * cell : 0
    return [inset * cell, inset * cell, size, r]
  })
}

function finderPath(corners: CornerStyle, points: PointStyle, cell: number, x: number, y: number): string {
  return finderLayers(corners, points, cell)
    .map(([ix, iy, size, r]) => roundedSquarePath(x + ix, y + iy, size, r))
    .join('')
}

/** SVG path (evenodd) of one finder pattern fitted into a `size`-unit icon box. */
export function cornerIconPath(corners: CornerStyle, points: PointStyle, size = 24, margin = 2): string {
  const cell = (size - margin * 2) / 7
  return finderPath(corners, points, cell, margin, margin)
}

function roundedSquarePath(x: number, y: number, size: number, r: number): string {
  const side = size - 2 * r
  if (r === 0) return `M ${x} ${y} h ${size} v ${size} h ${-size} Z `
  return `M ${x + r} ${y} h ${side} a ${r} ${r} 0 0 1 ${r} ${r} v ${side} a ${r} ${r} 0 0 1 ${-r} ${r} h ${-side} a ${r} ${r} 0 0 1 ${-r} ${-r} v ${-side} a ${r} ${r} 0 0 1 ${r} ${-r} Z `
}

/**
 * Fraction (0–1) of a grid cell inside the frame. `x0`/`y0` are the cell's top-left
 * relative to the QR center; only cells straddling the outline get sampled.
 */
function cellCoverage(geo: FrameGeometry, x0: number, y0: number, size: number): number {
  const inside = (x: number, y: number) => geo.inside(x / QR_HALF, y / QR_HALF)
  const probes = [
    inside(x0, y0),
    inside(x0 + size, y0),
    inside(x0, y0 + size),
    inside(x0 + size, y0 + size),
    inside(x0 + size / 2, y0 + size / 2),
  ]
  if (probes.every(Boolean)) return 1
  if (!probes.some(Boolean)) return 0

  // Sampling twice with a tiny vertical nudge counts samples that land exactly on a
  // grid-aligned edge (the heart's 45° sides) as half, so those cells read as exactly 50%.
  let hits = 0
  const step = size / COVERAGE_SAMPLES
  const nudge = step * 0.01
  for (let i = 0; i < COVERAGE_SAMPLES; i++) {
    const sy = y0 + (i + 0.5) * step
    for (let j = 0; j < COVERAGE_SAMPLES; j++) {
      const sx = x0 + (j + 0.5) * step
      if (inside(sx, sy - nudge)) hits++
      if (inside(sx, sy + nudge)) hits++
    }
  }
  return hits / (2 * COVERAGE_SAMPLES * COVERAGE_SAMPLES)
}

/** True for a fully-inside cell whose border lies on the outline (e.g. the hexagon's flat edges). */
function touchesOutline(geo: FrameGeometry, x0: number, y0: number, size: number): boolean {
  const e = size * 0.01
  return !(
    geo.inside((x0 - e) / QR_HALF, (y0 - e) / QR_HALF) &&
    geo.inside((x0 + size + e) / QR_HALF, (y0 - e) / QR_HALF) &&
    geo.inside((x0 - e) / QR_HALF, (y0 + size + e) / QR_HALF) &&
    geo.inside((x0 + size + e) / QR_HALF, (y0 + size + e) / QR_HALF)
  )
}

/** Deterministic PRNG so the filler dots stay put while other settings change. */
function seededRandom(seed: string): () => number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  let state = h >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function svgFileName(data: string): string {
  if (!data || data.trim() === '') return 'qrcode.svg'
  const name = data
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/[^a-z0-9.-]/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${name.length > 50 ? name.substring(0, 50) : name}.svg`
}
