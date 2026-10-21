import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: ['@sublate/kernel', '@sublate/plugin-sdk', '@sublate/shared'],
      }),
    ],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react()],
  },
})
