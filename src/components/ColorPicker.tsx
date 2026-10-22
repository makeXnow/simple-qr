import { useCallback, useEffect, useRef, useState } from 'react'
import { hexToRgb, rgbToHsv, type HsvaColor, type ResolvedColor } from '../lib/color'

interface ColorPickerProps {
  color: ResolvedColor
  onChange: (color: HsvaColor) => void
}

export function ColorPicker({ color, onChange }: ColorPickerProps) {
  const gridRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [hexDraft, setHexDraft] = useState<string | null>(null)
  const [opacityDraft, setOpacityDraft] = useState<string | null>(null)

  const colorRef = useRef(color)
  colorRef.current = color
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const updateFromPointer = useCallback((clientX: number, clientY: number) => {
    const grid = gridRef.current
    if (!grid) return
    const rect = grid.getBoundingClientRect()
    const s = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const v = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height))
    onChangeRef.current({ ...colorRef.current, s, v })
  }, [])

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: PointerEvent) => updateFromPointer(e.clientX, e.clientY)
    const onUp = () => setDragging(false)
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }
  }, [dragging, updateFromPointer])

  const onHexInput = (raw: string) => {
    const val = raw.replace(/[^0-9A-Fa-f]/g, '').slice(0, 6)
    setHexDraft(val)
    const rgb = val.length === 6 ? hexToRgb(val) : null
    if (rgb) {
      const [h, s, v] = rgbToHsv(rgb[0], rgb[1], rgb[2])
      onChange({ ...color, h, s, v })
    }
  }

  const onOpacityInput = (raw: string) => {
    setOpacityDraft(raw)
    const val = parseInt(raw.replace(/[^0-9]/g, ''), 10)
    if (!Number.isNaN(val)) {
      onChange({ ...color, a: Math.max(0, Math.min(100, val)) / 100 })
    }
  }

  return (
    <div className="color-picker-container">
      <div
        ref={gridRef}
        className="sb-grid"
        style={{ backgroundColor: `hsl(${color.h * 360}, 100%, 50%)` }}
        onPointerDown={(e) => {
          e.preventDefault()
          setDragging(true)
          updateFromPointer(e.clientX, e.clientY)
        }}
      >
        <div className="sb-grid-white" />
        <div className="sb-grid-black" />
        <div className="sb-thumb" style={{ left: `${color.s * 100}%`, top: `${(1 - color.v) * 100}%` }} />
      </div>

      <div className="slider-wrapper">
        <div className="hue-track" />
        <input
          type="range"
          className="custom-slider"
          min={0}
          max={360}
          value={color.h * 360}
          onChange={(e) => onChange({ ...color, h: Number(e.target.value) / 360 })}
        />
      </div>

      <div className="slider-wrapper">
        <div className="opacity-track-bg" />
        <div
          className="opacity-track-fill"
          style={{ background: `linear-gradient(to right, transparent, #${color.hex})` }}
        />
        <input
          type="range"
          className="custom-slider"
          min={0}
          max={100}
          value={color.a * 100}
          onChange={(e) => onChange({ ...color, a: Number(e.target.value) / 100 })}
        />
      </div>

      <div className="color-inputs-row">
        <div className="color-input-box label">
          <span>Hex</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 10l5 5 5-5" />
          </svg>
        </div>
        <div className="color-input-box hex">
          <span>#</span>
          <input
            type="text"
            maxLength={6}
            value={hexDraft ?? color.hex}
            onFocus={() => setHexDraft(color.hex)}
            onBlur={() => setHexDraft(null)}
            onChange={(e) => onHexInput(e.target.value)}
          />
        </div>
        <div className="color-input-box opacity">
          <input
            type="text"
            value={opacityDraft ?? `${Math.round(color.a * 100)}%`}
            onFocus={() => setOpacityDraft(`${Math.round(color.a * 100)}%`)}
            onBlur={() => setOpacityDraft(null)}
            onChange={(e) => onOpacityInput(e.target.value)}
          />
        </div>
      </div>
    </div>
  )
}
