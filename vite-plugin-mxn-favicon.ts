import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'

const LOCAL_BRIDGE = 'http://127.0.0.1:3001'
const PWA_ICON_PATH = '/__mxn/pwa-icon.png'
const PWA_MANIFEST_PATH = '/__mxn/manifest.webmanifest'

function resolveAssetUrl(raw: string): string {
  const iconPath = String(raw || '').trim()
  if (!iconPath) return ''
  if (iconPath.startsWith('http://') || iconPath.startsWith('https://')) return iconPath
  const normalized = iconPath.startsWith('/') ? iconPath : `/${iconPath}`
  return `${LOCAL_BRIDGE}${normalized}`
}

function eachLinkRel(html: string, fn: (rel: string) => void) {
  const linkRe = /<link\b[^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = linkRe.exec(html))) {
    const relM = /\brel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[0])
    if (!relM) continue
    fn((relM[1] || relM[2] || relM[3] || '').toLowerCase())
  }
}

function htmlHasExistingFavicon(html: string): boolean {
  let found = false
  eachLinkRel(html, (rel) => {
    if (rel.includes('apple-touch-icon') || /\bmanifest\b/.test(rel)) return
    if (/\bicon\b/.test(rel)) found = true
  })
  return found
}

function htmlHasExistingAppleTouchIcon(html: string): boolean {
  let found = false
  eachLinkRel(html, (rel) => {
    if (rel.includes('apple-touch-icon')) found = true
  })
  return found
}

function htmlHasExistingManifest(html: string): boolean {
  let found = false
  eachLinkRel(html, (rel) => {
    if (/\bmanifest\b/.test(rel)) found = true
  })
  return found
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
}

function wrapFavicon(src: string): string {
  const s = String(src || '').trim()
  if (!s || s.includes('/__mxn/favicon.svg')) return s
  return `${LOCAL_BRIDGE}/__mxn/favicon.svg?src=${encodeURIComponent(s)}`
}

function inject(html: string, faviconUrl: string, iconUrl: string): string {
  const href = wrapFavicon(faviconUrl || iconUrl)
  const pwaSrc = iconUrl || faviconUrl
  let tags = ''
  if (href && !htmlHasExistingFavicon(html)) {
    const isSvg = href.includes('/__mxn/favicon.svg')
    tags += `<link rel="icon"${isSvg ? ' type="image/svg+xml"' : ''} href="${escapeHtmlAttr(href)}">`
  }
  if (pwaSrc && !htmlHasExistingAppleTouchIcon(html)) {
    tags += `<link rel="apple-touch-icon" sizes="180x180" href="${PWA_ICON_PATH}?size=180">`
  }
  if (pwaSrc && !htmlHasExistingManifest(html)) {
    tags += `<link rel="manifest" href="${PWA_MANIFEST_PATH}">`
  }
  if (!tags) return html
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${tags}</head>`)
  if (/<head\b/i.test(html)) return html.replace(/<head\b[^>]*>/i, (open) => `${open}${tags}`)
  return html
}

function urlsFromApp(app: {
  name?: string
  icon?: string | { path?: string; favicon?: string }
  favicon?: string
}): { favicon: string; icon: string; name: string } {
  const iconPath =
    typeof app.icon === 'string' ? app.icon : String(app.icon?.path || '')
  const faviconPath =
    typeof app.favicon === 'string'
      ? app.favicon
      : typeof app.icon === 'object'
        ? String(app.icon?.favicon || '')
        : ''
  const icon = resolveAssetUrl(iconPath)
  const favicon = resolveAssetUrl(faviconPath) || icon
  return { favicon, icon: icon || favicon, name: String(app.name || '').trim() }
}

function lookupFromRegistry(): { favicon: string; icon: string; name: string } | null {
  const cwd = process.cwd()
  const home = process.env.HOME || process.env.USERPROFILE || ''
  const candidates = [
    process.env.MXN_INSTANCE_DIR
      ? path.resolve(process.env.MXN_INSTANCE_DIR, 'apps.json')
      : '',
    home ? path.join(home, '.makexnow', 'apps.json') : '',
    path.resolve(cwd, '../makeXnow/apps.json'),
    path.resolve(cwd, '../../makeXnow/apps.json'),
    path.resolve(cwd, '../apps.json'),
  ].filter(Boolean)
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue
      const data = JSON.parse(fs.readFileSync(file, 'utf8'))
      const apps = Array.isArray(data) ? data : data.apps || []
      const app = apps.find(
        (a: { folder?: string }) => a?.folder && path.resolve(a.folder) === cwd,
      )
      if (!app) continue
      const urls = urlsFromApp(app)
      if (urls.favicon || urls.icon) return urls
    } catch {
      /* ignore unreadable registry */
    }
  }
  return null
}

function send(res: ServerResponse, status: number, body: string | Buffer, contentType: string) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body)
  res.statusCode = status
  res.setHeader('Content-Type', contentType)
  res.setHeader('Content-Length', buf.length)
  res.end(buf)
}

async function proxyPwaIcon(req: IncomingMessage, res: ServerResponse, iconUrl: string) {
  const u = new URL(req.url || '/', 'http://127.0.0.1')
  const size = u.searchParams.get('size') || '512'
  const dest = `${LOCAL_BRIDGE}${PWA_ICON_PATH}?src=${encodeURIComponent(iconUrl)}&size=${encodeURIComponent(size)}`
  const upstream = await fetch(dest, { redirect: 'follow' })
  const buf = Buffer.from(await upstream.arrayBuffer())
  send(res, upstream.ok ? 200 : upstream.status, buf, upstream.headers.get('content-type') || 'image/png')
}

/**
 * Local-only: if index.html has no favicon / PWA icons, use the makeXnow dashboard app icon.
 * Deployed sites get the same fallback from the Cloudflare worker.
 * PWA icons are square (no rounded corners); tab favicons use the iOS squircle.
 */
export function mxnPlatformFavicon(): Plugin {
  return {
    name: 'mxn-platform-favicon',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const url = req.url || ''
          const pathOnly = url.split('?')[0]
          const icon = String(process.env.MXN_APP_ICON_URL || '').trim()
            || lookupFromRegistry()?.icon
            || ''
          const name = String(process.env.MXN_APP_NAME || '').trim()
            || lookupFromRegistry()?.name
            || 'App'
          if (pathOnly === PWA_MANIFEST_PATH) {
            const body = JSON.stringify({
              name,
              short_name: name.slice(0, 12),
              start_url: '/',
              scope: '/',
              display: 'standalone',
              icons: [
                { src: `${PWA_ICON_PATH}?size=192`, sizes: '192x192', type: 'image/png', purpose: 'any' },
                { src: `${PWA_ICON_PATH}?size=512`, sizes: '512x512', type: 'image/png', purpose: 'any' },
              ],
            })
            send(res, 200, body, 'application/manifest+json; charset=utf-8')
            return
          }
          if (pathOnly === PWA_ICON_PATH && icon) {
            await proxyPwaIcon(req, res, icon)
            return
          }
        } catch {
          /* fall through */
        }
        next()
      })
    },
    transformIndexHtml(html) {
      let favicon = String(process.env.MXN_APP_FAVICON_URL || '').trim()
      let icon = String(process.env.MXN_APP_ICON_URL || '').trim()
      if (!favicon && !icon) {
        const found = lookupFromRegistry()
        if (found) {
          favicon = found.favicon
          icon = found.icon
        }
      }
      if (!favicon && !icon) return html
      return inject(html, favicon || icon, icon || favicon)
    },
  }
}
