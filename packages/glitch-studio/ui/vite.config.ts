import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import * as Path from 'node:path';
import packageJson from '../../../package.json' with { type: 'json' };
import { iconFontPlugin } from './build/vite-plugin-icon-font.mjs';
import { visualModuleEmbedPlugin } from './build/vite-plugin-visual-module-embed.mjs';

const isElectron = process.env.BUILD_TARGET === 'electron';

// HTMLとWorkerの両方をcross-origin isolatedにし、performance.now()の丸めを緩和する。
// 公開ビルドの配信時は、ホスティング側で同じレスポンスヘッダーを設定する必要がある。
const crossOriginIsolationHeaders = {
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Embedder-Policy': 'require-corp',
};

// https://vitejs.dev/config/
export default defineConfig({
	base: isElectron ? '/' : '/glitch-studio/',
	build: {
		// 最新Chromeを対象とし、CSSとWorkerを含めて旧ブラウザー向けの構文変換を行わない。
		target: 'esnext',
		// Chromeのネイティブ実装を使い、先読み自体は維持したままポリフィルだけを除外する。
		modulePreload: { polyfill: false },
		outDir: isElectron ? 'dist-electron' : 'dist',
		rolldownOptions: {
			output: {
				charset: 'ascii',
			},
		},
	},
	plugins: [iconFontPlugin(), visualModuleEmbedPlugin(), vue()],
	resolve: {
		alias: {
			'@': Path.resolve(import.meta.dirname, 'src'),
		},
	},
	optimizeDeps: {
		// 開発時の依存ライブラリも、本番ビルドと同じく互換性のための構文変換を避ける。
		rolldownOptions: {
			transform: {
				target: 'esnext',
			},
		},
	},
	server: {
		host: true,
		allowedHosts: true,
		headers: crossOriginIsolationHeaders,
	},
	preview: {
		headers: crossOriginIsolationHeaders,
	},
	worker: {
		format: 'es',
		rolldownOptions: {
			output: {
				charset: 'ascii',
			},
		},
	},
	define: {
		_VERSION_: JSON.stringify(packageJson.version),
		__ELECTRON__: JSON.stringify(isElectron),
		// UIはComposition APIで実装しているため、未使用のOptions APIをビルドから除外する。
		__VUE_OPTIONS_API__: 'false',
	},
})
