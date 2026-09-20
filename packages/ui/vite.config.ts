import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import * as Path from 'node:path';
import packageJson from '../../package.json' with { type: 'json' };

const isElectron = process.env.BUILD_TARGET === 'electron';

// https://vitejs.dev/config/
export default defineConfig({
  base: isElectron ? '/' : '/glitch-studio/',
  build: { outDir: isElectron ? 'dist-electron' : 'dist' },
  plugins: [vue()],
  resolve: {
    alias: {
      '@': Path.resolve(import.meta.dirname, 'src'),
    },
  },
  server: {
    host: true,
    allowedHosts: true,
  },
	worker: {
		format: 'es',
	},
	define: {
		_VERSION_: JSON.stringify(packageJson.version),
		__ELECTRON__: JSON.stringify(isElectron),
	},
})
