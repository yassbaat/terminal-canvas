import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: '.',
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/preload/index.ts'),
      formats: ['cjs'],
      fileName: () => 'index.cjs',
    },
    outDir: 'dist/preload',
    emptyOutDir: true,
    rollupOptions: {
      external: ['electron'],
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
