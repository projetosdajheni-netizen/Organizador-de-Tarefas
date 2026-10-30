import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves the app from the repository subpath; Vercel serves it from the domain root.
  base: process.env.GITHUB_ACTIONS === 'true' ? '/Organizador-de-Tarefas/' : '/',
})
