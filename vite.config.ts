import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  return {
    root: process.cwd(),
    build: {
      lib: {
        entry: resolve(__dirname, 'src/index.ts'),
        name: 'URDFLoaders',
        fileName: 'urdf-loaders',
        formats: ['es', 'umd']
      },
      rollupOptions: {
        external: ['three'],
        output: {
          globals: {
            three: 'THREE'
          }
        }
      },
      sourcemap: true,
      emptyOutDir: true
    },
    server: {
      open: '/examples/index.html',
    }
  };
});