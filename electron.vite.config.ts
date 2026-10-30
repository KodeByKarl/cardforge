import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // exceljs (and its many transitive dependencies) is bundled into the main process: electron-builder's node_modules
    // collection missed a hoisted transitive dependency, which made the packaged app crash at start.
    plugins: [externalizeDepsPlugin({ exclude: ['exceljs'] })]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') }
    }
  }
})
