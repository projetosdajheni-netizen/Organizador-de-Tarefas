import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const runtimeProcess = Reflect.get(globalThis, 'process') as
  | { env?: Record<string, string | undefined> }
  | undefined

export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves the app from the repository subpath; Vercel serves it from the domain root.
  base: runtimeProcess?.env?.GITHUB_ACTIONS === 'true' ? '/Organizador-de-Tarefas/' : '/',
})
