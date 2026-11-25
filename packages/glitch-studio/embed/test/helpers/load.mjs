import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../../', import.meta.url));
const result = await build({
	absWorkingDir: directory, stdin: { resolveDir: directory, loader: 'ts', contents: `
		export { createPortableEffectInputs } from './src/effect-inputs.ts';
		export * from './src/runtime-requirements.ts';
		export * from './src/export.ts'; export * from './src/parameters.ts';
		export * from './src/protocol.ts'; export * from './src/archive.ts';
		export * from './src/frame-rate-limiter.ts';
		export { default as clickGradient } from '@gs/subsystems_effect_native-effects/fx/clickGradient/_def_.ts';
		export { default as clickRipple } from '@gs/subsystems_effect_native-effects/fx/clickRipple/_def_.ts';
		export { default as colorRamp } from '@gs/subsystems_effect_native-effects/fx/colorRamp/_def_.ts';
		export { default as fill } from '@gs/subsystems_effect_native-effects/fx/fill/_def_.ts';
		export { default as image } from '@gs/subsystems_effect_native-effects/fx/image/_def_.ts';
		export { default as symbols } from '@gs/subsystems_effect_native-effects/fx/symbols/_def_.ts';
	` },
	bundle: true, write: false, format: 'cjs', platform: 'node',
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
export const implementation = loaded.exports;
