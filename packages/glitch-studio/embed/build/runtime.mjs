import { build } from 'vite';
import { fileURLToPath } from 'node:url';

/** 開発・製品ビルド・成果物テストで同じ入口を使い、ブラウザー内ではコンパイルしない。 */
export async function buildPortableVisualModuleRuntime(onModule = () => {}) {
	const root = fileURLToPath(new URL('../', import.meta.url));
	const bundle = async (entry, name) => {
		const result = await build({
			configFile: false, root, logLevel: 'error',
			plugins: [{ name: 'portable-visual-module-dependencies', moduleParsed(info) { if (!info.id.includes('node_modules')) onModule(info.id.split('?')[0]); } }],
			build: {
				write: false, target: 'esnext', minify: true,
				lib: { entry: fileURLToPath(new URL(`../src/${entry}`, import.meta.url)), name, formats: ['iife'] },
				rolldownOptions: { output: { codeSplitting: false, charset: 'ascii' } },
			},
		});
		const output = (Array.isArray(result) ? result[0] : result).output;
		if (output.length !== 1 || output[0].type !== 'chunk') throw new Error('Portable runtime must be a self-contained JavaScript bundle');
		return output[0].code;
	};
	return {
		elementSource: await bundle('element.ts', 'GlitchStudioVisualModuleEmbed'),
		workerSource: await bundle('worker.ts', 'GlitchStudioVisualModuleWorker'),
	};
}
