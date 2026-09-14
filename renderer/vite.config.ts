import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => ({
  plugins: [react()],
  // 相对 base：Electron 打包后以 file:// 加载 dist/index.html
  base: './',
  server: {
    port: Number(process.env.VITE_PORT ?? 5173),
    strictPort: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true
  }
}));
