import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { mxnPlatformFavicon } from './vite-plugin-mxn-favicon'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    mxnPlatformFavicon(),
  ],
  // Use relative paths so the app works when hosted at /apps/your-app/
  base: './',
})
