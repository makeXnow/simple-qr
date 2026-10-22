import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ColorPicker } from './components/ColorPicker'
import { IconOptions } from './components/IconOptions'
import { resolveColor, type HsvaColor } from './lib/color'
import { FONT_FAMILIES, FONT_WEIGHTS, loadFont, type FontFamily, type FontWeight } from './lib/fonts'
import { FRAME_SHAPES, MAX_EDGE_THICKNESS, frameIconPath, type FrameShape } from './lib/frames'
import {
  CORNER_STYLES,
  POINT_STYLES,
  cornerIconPath,
  renderQr,
  svgFileName,
  type CornerStyle,
  type PointStyle,
} from './lib/qr'

const POINT_ICONS: Record<PointStyle, ReactNode> = {
  square: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <rect x="3" y="3" width="18" height="18" />
    </svg>
  ),
  rounded: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <rect x="3" y="3" width="18" height="18" rx="5.5" />
    </svg>
  ),
  circle: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="12" r="9" />
    </svg>
  ),
}

const POINT_OPTIONS = POINT_STYLES.map((s) => ({ ...s, icon: POINT_ICONS[s.value] }))
const FRAME_OPTIONS = FRAME_SHAPES.map((s) => ({
  ...s,
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d={frameIconPath(s.value)} />
    </svg>
  ),
}))

function App() {
  const [data, setData] = useState('')
  const [points, setPoints] = useState<PointStyle>('square')
  const [corners, setCorners] = useState<CornerStyle>('square')
  const [frame, setFrame] = useState<FrameShape>('square')
  const [edgeDefinition, setEdgeDefinition] = useState(1)
  const [edgeThickness, setEdgeThickness] = useState(0)
  const [hsva, setHsva] = useState<HsvaColor>({ h: 0, s: 0, v: 0, a: 1 })
  const [displayText, setDisplayText] = useState('')
  const [userEditedDisplayText, setUserEditedDisplayText] = useState(false)
  const [fontFamily, setFontFamily] = useState<FontFamily>('Roboto')
  const [fontWeight, setFontWeight] = useState<FontWeight>('600')
  const [fontSize, setFontSize] = useState('16')
  const [textDistance, setTextDistance] = useState('8')

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const svgRef = useRef('')

  const color = useMemo(() => resolveColor(hsva), [hsva])
  const cornerOptions = useMemo(
    () =>
      CORNER_STYLES.map((s) => ({
        ...s,
        icon: (
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path fillRule="evenodd" d={cornerIconPath(s.value, points)} />
          </svg>
        ),
      })),
    [points],
  )
  const luminance = 0.299 * color.r + 0.587 * color.g + 0.114 * color.b

  useEffect(() => {
    let cancelled = false
    const hasText = displayText.trim() !== ''
    const fontPromise = hasText ? loadFont(fontFamily, fontWeight) : Promise.resolve(null)

    fontPromise.then((font) => {
      const canvas = canvasRef.current
      if (cancelled || !canvas) return
      svgRef.current = renderQr(canvas, {
        data,
        points,
        corners,
        frame,
        edgeDefinition,
        edgeThickness,
        color,
        displayText,
        font,
        fontSize: parseInt(fontSize, 10) || 16,
        textDistance: parseInt(textDistance, 10) || 8,
      })
    })

    return () => {
      cancelled = true
    }
  }, [data, points, corners, frame, edgeDefinition, edgeThickness, color, displayText, fontFamily, fontWeight, fontSize, textDistance])

  const onDataChange = (value: string) => {
    setData(value)
    if (!userEditedDisplayText) setDisplayText(value)
  }

  const downloadSvg = () => {
    const blob = new Blob([svgRef.current], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = svgFileName(data)
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="layout">
      <div className="sidebar">
        <div className="sidebar-content">
          <div className="setting-group">
            <div className="setting-group-title">URL</div>
            <input
              type="text"
              placeholder="Enter URL or text..."
              value={data}
              onChange={(e) => onDataChange(e.target.value)}
            />
          </div>

          <div className="setting-group">
            <div className="setting-group-title">Design</div>
            <label>Points</label>
            <IconOptions options={POINT_OPTIONS} value={points} onChange={setPoints} />

            <label style={{ marginTop: '0.5rem' }}>Corners</label>
            <IconOptions options={cornerOptions} value={corners} onChange={setCorners} />

            <label style={{ marginTop: '0.5rem' }}>Shape</label>
            <IconOptions options={FRAME_OPTIONS} value={frame} onChange={setFrame} />

            {frame !== 'square' && (
              <div style={{ marginTop: '0.5rem' }}>
                <label>
                  Edge Definition
                  <span className="label-value">{edgeDefinition}</span>
                </label>
                <input
                  type="range"
                  className="plain-slider"
                  min={1}
                  max={100}
                  value={edgeDefinition}
                  onChange={(e) => setEdgeDefinition(parseInt(e.target.value, 10))}
                />

                <label style={{ marginTop: '0.75rem' }}>
                  Edge Thickness
                  <span className="label-value">{edgeThickness}</span>
                </label>
                <input
                  type="range"
                  className="plain-slider"
                  min={0}
                  max={MAX_EDGE_THICKNESS}
                  step={1}
                  value={edgeThickness}
                  onChange={(e) => setEdgeThickness(parseInt(e.target.value, 10))}
                />
              </div>
            )}

            <div style={{ marginTop: '0.5rem' }}>
              <label>Color</label>
              <ColorPicker color={color} onChange={setHsva} />
            </div>
          </div>

          <div className="setting-group" style={{ gap: '1rem' }}>
            <div className="setting-group-title" style={{ marginBottom: '-0.5rem' }}>Bottom Label</div>

            <div>
              <label>Display Text</label>
              <input
                type="text"
                placeholder="Text to show..."
                value={displayText}
                onChange={(e) => {
                  setUserEditedDisplayText(true)
                  setDisplayText(e.target.value)
                }}
              />
            </div>

            <div className="row">
              <div>
                <label>Font Family</label>
                <select value={fontFamily} onChange={(e) => setFontFamily(e.target.value as FontFamily)}>
                  {FONT_FAMILIES.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>Weight</label>
                <select value={fontWeight} onChange={(e) => setFontWeight(e.target.value as FontWeight)}>
                  {FONT_WEIGHTS.map((w) => (
                    <option key={w.value} value={w.value}>{w.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="row">
              <div>
                <label>Font Pt Size</label>
                <input type="number" min={10} value={fontSize} onChange={(e) => setFontSize(e.target.value)} />
              </div>
              <div>
                <label>Distance</label>
                <input type="number" min={0} max={100} value={textDistance} onChange={(e) => setTextDistance(e.target.value)} />
              </div>
            </div>
          </div>

          <button className="download-btn" onClick={downloadSvg}>Download SVG</button>
        </div>
      </div>

      <div className="preview-area" style={{ backgroundColor: luminance > 128 ? '#1f2937' : '#f3f4f6' }}>
        <div className="qr-wrapper">
          <canvas ref={canvasRef} />
        </div>
      </div>
    </div>
  )
}

export default App
