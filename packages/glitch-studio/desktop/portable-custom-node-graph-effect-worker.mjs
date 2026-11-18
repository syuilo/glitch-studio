import { buildPortableCustomNodeGraphEffectRuntime } from '@gs/glitch-studio_embed/build/runtime.mjs';

// Node APIやビルド資材は成果物へ渡さない。このプロセスは一回の生成だけを担当する。
process.parentPort.once('message', async ({ data: requirements }) => {
	try {
		const runtime = await buildPortableCustomNodeGraphEffectRuntime(process.argv[2], requirements);
		process.parentPort.postMessage({ runtime });
	} catch (error) {
		process.parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) });
	}
});
