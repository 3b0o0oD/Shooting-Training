import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import electronRenderer from 'vite-plugin-electron-renderer';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            lib: {
              entry: 'electron/main.ts',
              formats: ['es'],
            },
            rollupOptions: {
              external: ['electron', 'path', 'url', 'better-sqlite3'],
              output: {
                entryFileNames: 'main.js',
              },
            },
          },
        },
      },
      {
        entry: 'electron/preload.js',
        onstart({ reload }) {
          // The preload.js is already valid CJS — just copy it to dist-electron
          import('fs').then(fs => {
            fs.mkdirSync('dist-electron', { recursive: true });
            fs.copyFileSync('electron/preload.js', 'dist-electron/preload.js');
            reload();
          });
        },
      },
    ]),
    electronRenderer(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
