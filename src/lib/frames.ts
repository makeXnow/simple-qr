export type FrameShape = 'square' | 'circle' | 'hexagon' | 'octagon' | 'heart' | 'shield' | 'bubble'

export const FRAME_SHAPES: { value: FrameShape; label: string }[] = [
  { value: 'square', label: 'Square' },
  { value: 'circle', label: 'Circle' },
  { value: 'hexagon', label: 'Hexagon' },
  { value: 'octagon', label: 'Octagon' },
  { value: 'heart', label: 'Heart' },
  { value: 'shield', label: 'Shield' },
  { value: 'bubble', label: 'Speech bubble' },
]

type Point = [number, number]

/**
 * Outline that the QR is inscribed in, in coordinates centered on the QR's center
 * (y grows downward) and scaled so the QR's half-size is 1.
 */
export interface FrameGeometry {
  outline: Point[]
  inside: (x: number, y: number) => boolean
  minX: number
  maxX: number
  minY: number
  maxY: number
  /** Cells containing these points are always filled (e.g. the heart's bottom point). */
  anchors?: Point[]
}

const CIRCLE_SEGMENTS = 256
const HEART_ARC_SEGMENTS = 96
const SHIELD_ARC_SEGMENTS = 64
const BUBBLE_CORNER_SEGMENTS = 24
// Shield bottom arc radius as a multiple of its half-width; larger is pointier but taller.
const SHIELD_ARC_RADIUS = 1.4
// Speech bubble margin around the QR, corner radius (× margin), and tail size, all before snapping.
const BUBBLE_MARGIN_CELLS = 2
const BUBBLE_CORNER_RADIUS = 2.5
// The tail is coarse at dot resolution, so it's kept big enough to read as a pointer.
const BUBBLE_TAIL_X = -0.72
const BUBBLE_TAIL_SIZE = 0.85
// Two cells keeps the outline row outside the empty ring around the finder patterns.
const SHIELD_MARGIN_CELLS = 2
// Module count used to draw the sidebar icons.
const ICON_MODULE_COUNT = 25

/** Smallest grid line ≥ v. Grid lines sit at ±1 + k·cell (the QR's edges), for any integer k. */
function toGridLine(v: number, cell: number): number {
  return 1 + Math.ceil((v - 1) / cell - 1e-9) * cell
}

function polygonGeometry(outline: Point[], inside = (x: number, y: number) => pointInPolygon(outline, x, y)): FrameGeometry {
  const xs = outline.map((p) => p[0])
  const ys = outline.map((p) => p[1])
  return { outline, inside, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
}

function pointInPolygon(poly: Point[], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Circumscribed circle (passes through the QR's four corners), grown by `grow`. */
function circle(grow = 0): FrameGeometry {
  const r = Math.SQRT2 + grow
  const outline: Point[] = []
  for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
    const t = (i / CIRCLE_SEGMENTS) * Math.PI * 2
    outline.push([r * Math.cos(t), r * Math.sin(t)])
  }
  return polygonGeometry(outline, (x, y) => x * x + y * y <= r * r)
}

/**
 * Flat-top hexagon whose slanted edges pass through the QR's corners (x + y/√3 = R at (1, 1)).
 *
 * With `cell` (module size in the same units) it's built around six always-filled corner cells:
 * the flat top/bottom sit on a grid line, the four top/bottom vertices are nudged out to the
 * next grid corner (so each is the outer corner of a cell), and the left/right points are
 * nudged out to the next vertical grid line on the center row (so each is the middle of a
 * cell's outer edge). Nudges are always outward and under one cell, so the QR stays inside.
 * `layers` pushes every edge out by that many cells.
 */
function hexagon(cell?: number, layers = 0): FrameGeometry {
  let apothem = (Math.sqrt(3) + 1) / 2
  let topX = apothem / Math.sqrt(3)
  let sideX = (2 * apothem) / Math.sqrt(3)
  const anchors: Point[] = []
  if (cell) {
    apothem = toGridLine(apothem, cell) + layers * cell
    topX = toGridLine(apothem / Math.sqrt(3), cell)
    sideX = toGridLine((2 * apothem) / Math.sqrt(3), cell)
    const half = cell / 2
    for (const sx of [1, -1]) {
      anchors.push([sx * (sideX - half), 0])
      for (const sy of [1, -1]) anchors.push([sx * (topX - half), sy * (apothem - half)])
    }
  }
  const outline: Point[] = [
    [sideX, 0],
    [topX, apothem],
    [-topX, apothem],
    [-sideX, 0],
    [-topX, -apothem],
    [topX, -apothem],
  ]
  return { ...polygonGeometry(outline), anchors }
}

/**
 * Geometric heart: a square rotated 45° with semicircle lobes on its two upper sides.
 *
 * Built around a single "tip" cell in the center column that is always filled. With an odd
 * module count the center column straddles x = 0, so the 45° lower sides are placed to meet at
 * that cell's bottom-center: x ± y = tipY with tipY = 2 + (layers + ½)·cell. Those lines run
 * through cell-edge midpoints, so every cell along them is cleanly 87.5% in or 12.5% in.
 * The notch sits one cell above the QR's top edge so the outline never enters the QR.
 * `layers` pushes the lower sides out and lifts the notch by whole cells.
 */
function heart(cell = 0, layers = 0): FrameGeometry {
  const tipY = 2 + (layers + 0.5) * cell
  const notchY = -1 - cell - layers * cell
  const half = (tipY - notchY) / 2 // half-diagonal of the rotated square
  const centerY = tipY - half
  const r = (half * Math.SQRT2) / 2 // lobe radius = half the rotated square's side
  const lobeX = half / 2
  const lobeY = centerY - half / 2

  const outline: Point[] = [[0, tipY]]
  // Right lobe: from the right vertex, bulging outward, up and over to the notch.
  for (let i = 0; i <= HEART_ARC_SEGMENTS; i++) {
    const t = Math.PI / 4 - (i / HEART_ARC_SEGMENTS) * Math.PI
    outline.push([lobeX + r * Math.cos(t), lobeY + r * Math.sin(t)])
  }
  // Left lobe mirrors the right, from the notch back down to the left vertex.
  for (let i = 1; i <= HEART_ARC_SEGMENTS; i++) {
    const t = (-3 * Math.PI) / 4 + (i / HEART_ARC_SEGMENTS) * Math.PI
    outline.push([-(lobeX + r * Math.cos(t)), lobeY + r * Math.sin(t)])
  }
  return { ...polygonGeometry(outline), anchors: cell ? [[0, tipY - cell / 2]] : [] }
}

/**
 * Near-regular octagon with all eight vertices on grid vertices, so flat sides lie on grid lines,
 * diagonal sides run through grid vertices, and each vertex's inside cell is always filled.
 *
 * In cells from the center, a vertex sits at (flat, end) with flat = j + ½ and end = i + ½
 * (the center falls mid-cell for odd module counts). The diagonal x + y = i + j + 1 must reach
 * the QR's corner (i + j ≥ 2n for 2n + 1 modules), and the side lengths are 2·end for flat
 * sides vs √2·(flat − end) for diagonals. Of the tightest few placements, the one whose two
 * side lengths are closest is used. Each of `layers` picks again starting one diagonal step
 * further out than the previous pick, so every layer is strictly bigger.
 */
function octagon(cell: number, layers = 0): FrameGeometry {
  const n = Math.round(1 / cell - 0.5)
  let minSum = 2 * n
  let best = { i: 0, j: 0, sum: 0, mismatch: Infinity }
  for (let layer = 0; layer <= layers; layer++) {
    best = { i: 0, j: 0, sum: 0, mismatch: Infinity }
    for (const sum of [minSum, minSum + 1]) {
      for (let run = sum % 2; run <= sum; run += 2) {
        const i = (sum - run) / 2
        const j = i + run
        if (j < n) continue
        const flatSide = 2 * i + 1
        const diagSide = Math.SQRT2 * run
        const mismatch = Math.abs(flatSide - diagSide) / Math.max(flatSide, diagSide)
        if (mismatch < best.mismatch) best = { i, j, sum, mismatch }
      }
    }
    minSum = best.sum + 1
  }
  const flat = (best.j + 0.5) * cell
  const end = (best.i + 0.5) * cell
  const outline: Point[] = [
    [flat, -end],
    [flat, end],
    [end, flat],
    [-end, flat],
    [-flat, end],
    [-flat, -end],
    [-end, -flat],
    [end, -flat],
  ]
  const half = cell / 2
  const anchors = outline.map(([x, y]): Point => [x - Math.sign(x) * half, y - Math.sign(y) * half])
  return { ...polygonGeometry(outline), anchors }
}

/**
 * Heraldic shield: flat top and straight sides on grid lines `SHIELD_MARGIN_CELLS` (plus `layers`)
 * out from the QR, then two arcs tangent to the sides that meet in a point on the center column. Like
 * the heart, the point is the bottom-center of an always-filled tip cell; the two top corner
 * cells are always filled too. The arcs start as high as they can while keeping the QR's
 * bottom corners half a cell (plus `layers`) inside.
 */
function shield(cell: number, layers = 0): FrameGeometry {
  const margin = (SHIELD_MARGIN_CELLS + layers) * cell
  const halfWidth = 1 + margin
  const top = -1 - margin
  const nominalR = SHIELD_ARC_RADIUS * halfWidth
  const centerX = halfWidth - nominalR
  const reach = nominalR - (0.5 + layers) * cell
  const cornerDx = 1 - centerX
  const arcTop = reach > cornerDx ? 1 - Math.sqrt(reach * reach - cornerDx * cornerDx) : 1
  const tipY = toGridLine(arcTop + Math.sqrt(nominalR * nominalR - centerX * centerX), cell)
  const depth = tipY - arcTop
  const r = (halfWidth * halfWidth + depth * depth) / (2 * halfWidth)
  const cx = halfWidth - r
  const endAngle = Math.atan2(depth, -cx)

  const outline: Point[] = [
    [-halfWidth, top],
    [halfWidth, top],
  ]
  for (let i = 0; i <= SHIELD_ARC_SEGMENTS; i++) {
    const t = (i / SHIELD_ARC_SEGMENTS) * endAngle
    outline.push([cx + r * Math.cos(t), arcTop + r * Math.sin(t)])
  }
  for (let i = SHIELD_ARC_SEGMENTS - 1; i >= 0; i--) {
    const t = (i / SHIELD_ARC_SEGMENTS) * endAngle
    outline.push([-(cx + r * Math.cos(t)), arcTop + r * Math.sin(t)])
  }
  const half = cell / 2
  const anchors: Point[] = [
    [halfWidth - half, top + half],
    [-(halfWidth - half), top + half],
    [0, tipY - half],
  ]
  return { ...polygonGeometry(outline), anchors }
}

/**
 * Speech bubble: a rounded rectangle on grid lines `BUBBLE_MARGIN_CELLS` (plus `layers`) out
 * from the QR, with a tail off the bottom-left. The tail has a vertical inner edge on a grid
 * line and a 45° outer edge through grid vertices, ending in an always-filled tip cell.
 */
function bubble(cell: number, layers = 0): FrameGeometry {
  const margin = (BUBBLE_MARGIN_CELLS + layers) * cell
  const w = 1 + margin
  const h = 1 + margin
  const r = BUBBLE_CORNER_RADIUS * margin
  const tailX = -toGridLine(-BUBBLE_TAIL_X, cell)
  const tail = Math.max(2, Math.round(BUBBLE_TAIL_SIZE / cell)) * cell

  const outline: Point[] = []
  const corner = (cx: number, cy: number, from: number) => {
    for (let i = 0; i <= BUBBLE_CORNER_SEGMENTS; i++) {
      const t = from + (i / BUBBLE_CORNER_SEGMENTS) * (Math.PI / 2)
      outline.push([cx + r * Math.cos(t), cy + r * Math.sin(t)])
    }
  }
  corner(-w + r, -h + r, Math.PI)
  corner(w - r, -h + r, -Math.PI / 2)
  corner(w - r, h - r, 0)
  outline.push([tailX + tail, h], [tailX, h + tail], [tailX, h])
  corner(-w + r, h - r, Math.PI / 2)

  return { ...polygonGeometry(outline), anchors: [[tailX + cell / 2, h + tail - cell / 2]] }
}

const BASE_CIRCLE = circle()

export const MAX_EDGE_THICKNESS = 3

/** Geometry for a QR with `moduleCount` modules per side, grown by `thickness` extra layers of cells. */
export function frameGeometry(
  frame: Exclude<FrameShape, 'square'>,
  moduleCount: number,
  thickness = 0,
): FrameGeometry {
  const cell = 2 / moduleCount
  const layers = Math.max(0, Math.min(MAX_EDGE_THICKNESS, Math.round(thickness)))
  switch (frame) {
    case 'hexagon':
      return hexagon(cell, layers)
    case 'octagon':
      return octagon(cell, layers)
    case 'heart':
      return heart(cell, layers)
    case 'shield':
      return shield(cell, layers)
    case 'bubble':
      return bubble(cell, layers)
    case 'circle':
      return layers === 0 ? BASE_CIRCLE : circle(layers * cell)
  }
}

const SQUARE_OUTLINE: Point[] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
]

/** SVG path of the frame outline fitted into a `size`-unit box with `margin` on every side. */
export function frameIconPath(frame: FrameShape, size = 24, margin = 3.5): string {
  const geo = frame === 'square' ? polygonGeometry(SQUARE_OUTLINE) : frameGeometry(frame, ICON_MODULE_COUNT)
  const w = geo.maxX - geo.minX
  const h = geo.maxY - geo.minY
  const scale = (size - margin * 2) / Math.max(w, h)
  const ox = (size - w * scale) / 2 - geo.minX * scale
  const oy = (size - h * scale) / 2 - geo.minY * scale
  return (
    geo.outline
      .map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${(ox + x * scale).toFixed(2)} ${(oy + y * scale).toFixed(2)}`)
      .join(' ') + ' Z'
  )
}
