import opentype from 'opentype.js'

export const FONT_FAMILIES = ['Roboto', 'Montserrat', 'Open Sans', 'Oswald'] as const
export type FontFamily = (typeof FONT_FAMILIES)[number]

export const FONT_WEIGHTS = [
  { value: '400', label: 'Normal' },
  { value: '500', label: 'Medium' },
  { value: '600', label: 'Semi-Bold' },
  { value: '700', label: 'Bold' },
] as const
export type FontWeight = (typeof FONT_WEIGHTS)[number]['value']

const fontCache = new Map<string, Promise<opentype.Font | null>>()

export function loadFont(family: FontFamily, weight: FontWeight): Promise<opentype.Font | null> {
  // Fontsource doesn't publish Roboto at 600.
  const actualWeight = family === 'Roboto' && weight === '600' ? '700' : weight
  const slug = family.toLowerCase().replace(/ /g, '-')
  const key = `${slug}-${actualWeight}`

  let pending = fontCache.get(key)
  if (!pending) {
    const url = `https://cdn.jsdelivr.net/npm/@fontsource/${slug}/files/${slug}-latin-${actualWeight}-normal.woff`
    pending = opentype.load(url).catch((err: unknown) => {
      console.error('Font load error:', err)
      fontCache.delete(key)
      return null
    })
    fontCache.set(key, pending)
  }
  return pending
}
