import { buildPortableVisualModuleRuntime } from '@gs/glitch-studio_embed/build/runtime.mjs';

export function visualModuleEmbedPlugin() {
	const id = 'virtual:visual-module-embed-runtime';
	return {
		name: 'visual-module-embed-runtime',
		resolveId(source) { if (source === id) return '\0' + id; },
		async load(source) {
			if (source !== '\0' + id) return;
			const runtime = await buildPortableVisualModuleRuntime(path => this.addWatchFile(path));
			return `export default ${JSON.stringify(runtime)};`;
		},
	};
}
