import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves the site under /<repo>/ — the workflow sets BASE_PATH.
export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_PATH ?? '/',
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
