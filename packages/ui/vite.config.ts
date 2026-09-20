import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import * as Path from 'node:path';
import packageJson from './package.json' with { type: 'json' };

// https://vitejs.dev/config/
export default defineConfig({
  base: '/glitch-studio/',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': Path.resolve('src'),
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
	},
})
