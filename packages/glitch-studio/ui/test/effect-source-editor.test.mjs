import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createTestProject } from './helpers/project.mjs';

const directory = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({
	absWorkingDir: directory, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'],
	stdin: { loader: 'ts', resolveDir: directory, contents: `
		export { ProjectContext } from './src/Project.ts';
		export { RendererProjectSynchronizer } from './src/RendererProjectSynchronizer.ts';
		export { applyRendererProjectChanges } from '@gs/glitch-studio_shared/project/renderer-state.ts';
		export { collectCustomNodeGraphEffectFile, encodeCustomNodeGraphEffectFile, decodeCustomNodeGraphEffectFile, prepareCustomNodeGraphEffectImport } from './src/custom-node-graph-effect-file-codec.ts';
		export { nativeEffectDefinitions } from '@gs/subsystems_effect-new_native-effects/definitions.ts';
		export { validateEffectSource } from '@gs/subsystems_effect-new_shared/validate-effect-source.ts';
		export { getEffectDefinitions } from './src/utility/project-effects.ts';
	` },
	plugins: [{ name: 'editor-settings', setup(builder) {
		builder.onResolve({ filter: /preferences\.ts$/ }, () => ({ path: 'preferences', namespace: 'fixture' }));
		builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const preferences = { s: {} };' }));
	} }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { ProjectContext, RendererProjectSynchronizer, applyRendererProjectChanges, nativeEffectDefinitions, validateEffectSource,
	getEffectDefinitions, collectCustomNodeGraphEffectFile, encodeCustomNodeGraphEffectFile, decodeCustomNodeGraphEffectFile, prepareCustomNodeGraphEffectImport } = module.exports;
const scene = () => ({ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [] });

// 【公開入力からRelay・出力を結ぶ操作を新形式で保存し、UndoとRedoでも同じ配線に戻す】
// 仮想的なIn/Outはエディタだけの表示であり、描画用のノード配列に混入するとGPU初期化時に解決できない。
test('edits and restores public-input relay wiring using the stored Effect definition', () => {
	const manager = new ProjectContext(createTestProject()).stateManager;
	const target = manager.commit('createCustomNodeGraphEffect', {});
	const entry = manager.state.customNodeGraphEffects.value[0];
	const relay = manager.commit('createCustomNodeGraphEffectRelayNode', { customNodeGraphEffect: target });
	const parameterId = entry.definition.primaryInputParameter;
	const outputId = entry.definition.primaryOutput;
	manager.commit('setCustomNodeGraphEffectRelayInput', { target: relay, source: { nodeId: 'globalIn', outputPort: parameterId } });
	manager.commit('setCustomNodeGraphEffectOutputConnection', { target: { customNodeGraphEffect: target, outputId }, source: { nodeId: relay.nodeId, outputPort: 'output' } });
	const read = () => entry.definition;
	assert.deepEqual(read().nodes.map(node => node.type), ['relay']);
	assert.deepEqual(read().nodes[0].input, { parameterId });
	assert.deepEqual(read().outputSources[outputId], { nodeId: relay.nodeId, outputPort: 'output' });
	validateEffectSource({ type: 'customNodeGraphEffectReference', id: entry.id }, getEffectDefinitions(manager.state));
	manager.undo();
	assert.equal(read().outputSources[outputId], undefined);
	manager.redo();
	assert.deepEqual(read().outputSources[outputId], { nodeId: relay.nodeId, outputPort: 'output' });
	manager.commit('removeCustomNodeGraphEffectOutput', { target: { customNodeGraphEffect: target, outputId } });
	assert.equal(read().outputSources[outputId], undefined);
	manager.undo();
	assert.deepEqual(read().outputSources[outputId], { nodeId: relay.nodeId, outputPort: 'output' });
});

// 【公開入力の削除をUndoすると自動解像度の参照も復元する】
// ポートIDだけを復元すると、Undo後に同じ画像へつなぎ直しても描画寸法が変わってしまう。
test('restores the resolution input when undoing removal of the primary public input', () => {
	const manager = new ProjectContext(createTestProject()).stateManager;
	const target = manager.commit('createCustomNodeGraphEffect', {});
	const { definition } = manager.state.customNodeGraphEffects.value[0];
	const parameterId = definition.primaryInputParameter;
	manager.commit('removeCustomNodeGraphEffectPublicParameter', { target: { customNodeGraphEffect: target, parameterId } });
	assert.deepEqual(definition.resolutionInputParameters, []);
	manager.undo();
	assert.equal(definition.primaryInputParameter, parameterId);
	assert.deepEqual(definition.resolutionInputParameters, [parameterId]);
	manager.redo();
	assert.deepEqual(definition.resolutionInputParameters, []);
});

// 【Native・参照・インラインの配置を同じTimeline Commandで作成する】
// 同じ種類のレイヤーとして作成・同期され、登録IDとインライン定義をそのまま取り出せることを確認する。
test('creates all five Effect sources through the Timeline command and synchronizes them', async t => {
	const project = createTestProject({ timelineScenes: [scene()] });
	const manager = new ProjectContext(project).stateManager;
	let replica = structuredClone({ automationGraphs: [], customNodeGraphEffects: [], customShaderEffects: [], timelineScenes: [scene()] });
	const sync = new RendererProjectSynchronizer(manager, { async apply(changes) { replica = applyRendererProjectChanges(replica, changes); }, onUpdated() {}, onError(error) { throw error; } });
	t.after(() => sync.dispose());
	const { customShaderEffectId } = manager.commit('createCustomShaderEffect', {});
	const { customNodeGraphEffectId } = manager.commit('createCustomNodeGraphEffect', {});
	const sources = [
		{ type: 'nativeEffect', id: 'fill' }, { type: 'customShaderEffectReference', id: customShaderEffectId },
		{ type: 'inlineCustomShaderEffect', customShaderEffect: manager.state.customShaderEffects.value[0].definition },
		{ type: 'customNodeGraphEffectReference', id: customNodeGraphEffectId },
		{ type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: manager.state.customNodeGraphEffects.value[0].definition },
	];
	for (const effectSource of sources) manager.commit('createTimelineLayer', { sceneId: 'scene', layer: { layerType: 'effect', effectSource }, clips: [] });
	await sync.flush();
	assert.deepEqual(replica.timelineScenes[0].layers.map(layer => layer.effectSource.type).sort(), sources.map(source => source.type).sort());
	for (const layer of replica.timelineScenes[0].layers) assert.equal(layer.layerType, 'effect');
});

// 【登録Shaderを使うグラフを書き出して別プロジェクトに取り込み、Undoで一括して戻す】
// 取り込み元の登録IDが残ると、同じ作品を複数回読み込んだときに別のShaderを参照してしまう。
test('round-trips registered shader nodes with their dependency and editor metadata', async () => {
	const manager = new ProjectContext(createTestProject()).stateManager;
	const { customShaderEffectId } = manager.commit('createCustomShaderEffect', {});
	const target = manager.commit('createCustomNodeGraphEffect', {});
	const node = manager.commit('createCustomNodeGraphEffectEffectNode', { customNodeGraphEffect: target, effectSource: { type: 'customShaderEffectReference', id: customShaderEffectId }, connectionMode: 'appendToPrimaryOutput' });
	manager.commit('setCustomNodeGraphEffectNodeDisplayName', { target: node, displayName: 'Lens' });
	const project = manager.state;
	const entry = project.customNodeGraphEffects.value[0];
	const file = collectCustomNodeGraphEffectFile({ gsVersion: '1.0.0', name: entry.name, customNodeGraphEffect: entry.definition, nodeMetadata: entry.nodeMetadata,
		customNodeGraphEffects: project.customNodeGraphEffects.value, customShaderEffects: project.customShaderEffects.value, assets: [], players: [] }, nativeEffectDefinitions);
	const imported = prepareCustomNodeGraphEffectImport(decodeCustomNodeGraphEffectFile(await encodeCustomNodeGraphEffectFile(file), '1.0.0'), nativeEffectDefinitions);
	const receiver = new ProjectContext(createTestProject()).stateManager;
	receiver.commit('importCustomNodeGraphEffect', imported);
	assert.equal(imported.customNodeGraphEffect.nodeMetadata[node.nodeId].displayName, 'Lens');
	assert.equal(imported.customNodeGraphEffect.definition.nodes[0].effectSource.id, receiver.state.customShaderEffects.value[0].id);
	assert.notEqual(imported.customNodeGraphEffect.definition.nodes[0].effectSource.id, customShaderEffectId);
	receiver.undo();
	assert.equal(receiver.state.customShaderEffects.value.length, 0);
	assert.equal(receiver.state.customNodeGraphEffects.value.length, 0);
	receiver.redo();
	assert.equal(receiver.state.customShaderEffects.value.length, 1);
});
