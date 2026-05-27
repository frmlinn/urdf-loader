import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  const isDemo = mode === 'demo';

  if (isDemo) {
    return {
      root: resolve(__dirname, 'demo'),
      build: {
        outDir: resolve(__dirname, 'dist-demo'),
        emptyOutDir: true,
        rollupOptions: {
          input: {
            t12: resolve(__dirname, 'demo/t12/index.html'),
            mhs: resolve(__dirname, 'demo/mhs/index.html')
          }
        }
      }
    };
  }

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
      open: '/demo/t12/index.html',
    }
  };
});