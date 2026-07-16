import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' keeps asset paths relative so it works on GitHub Pages subpaths too.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    // Honor the port the harness assigns (autoPort), and expose to the LAN so
    // a phone on the same Wi-Fi can open it. Falls back to 5173 locally.
    host: true,
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
  },
})
