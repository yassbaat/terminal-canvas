import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: '.',
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/main/index.ts'),
      formats: ['cjs'],
      fileName: () => 'index.cjs',
    },
    outDir: 'dist/main',
    emptyOutDir: true,
    rollupOptions: {
      external: ['electron', 'node-pty', 'path', 'os', 'fs', 'child_process', 'util', 'crypto'],
    },
    sourcemap: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@main': path.resolve(__dirname, './src/main'),
      '@preload': path.resolve(__dirname, './src/preload'),
      '@renderer': path.resolve(__dirname, './src/renderer'),
    },
  },
});
