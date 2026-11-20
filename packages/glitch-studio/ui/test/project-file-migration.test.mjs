import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { decode, encode } from '@msgpack/msgpack';
import { build } from 'esbuild';

const bundle = await build({
	absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
	entryPoints: ['./src/gsproj.ts'],
	bundle: true, platform: 'node', format: 'cjs', write: false,
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { decodeProjectFile, encodeProjectFile } = module.exports;

// 【各種EffectSourceを保持してプロジェクトを保存・再読込する】
// 同じIDを持つNativeと登録Shaderを混同せず、インライン定義もファイルへ含める。
test('preserves Effect source discriminators and inline definitions on disk', async () => {
	const graph = { kind: 'generate', paramDefs: {}, outputDefs: { color: { dataType: { kind: 'color' } } },
		primaryInputParameter: null, primaryOutput: 'color', resolutionInputParameters: [], nodes: [], outputSources: {} };
	const sources = [{ type: 'nativeEffect', id: 'same' }, { type: 'customShaderEffectReference', id: 'same' },
		{ type: 'customNodeGraphEffectReference', id: 'registered' }, { type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: graph }];
	const project = { gsVersion: '1.0.0', assets: [], generatedSpeech: [], players: [], customShaderEffects: [], customNodeGraphEffects: [{ id: 'registered', name: 'Registered', definition: graph }],
		timelineScenes: [{ id: 'scene', layers: sources.map((effectSource, index) => ({ id: String(index), layerType: 'effect', effectSource })) }] };
	const restored = await decodeProjectFile(await encodeProjectFile(project), '1.0.0');
	assert.deepEqual(restored.timelineScenes[0].layers.map(layer => layer.effectSource), sources);
	assert.deepEqual(restored.customNodeGraphEffects, project.customNodeGraphEffects);
});
