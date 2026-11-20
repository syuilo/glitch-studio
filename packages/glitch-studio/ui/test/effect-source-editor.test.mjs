import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createTestProject } from './helpers/project.mjs';
import { testGraph } from './helpers/effect-graph.mjs';

const directory = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({
	absWorkingDir: directory, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'],
	stdin: { loader: 'ts', resolveDir: directory, contents: `
		export { ProjectContext } from './src/Project.ts';
		export { ProjectRenderValidation } from './src/ProjectRenderValidation.ts';
		export { deepClone } from '@gs/shared/utility/deep-clone.ts';
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
const { ProjectContext, ProjectRenderValidation, RendererProjectSynchronizer, applyRendererProjectChanges, deepClone, nativeEffectDefinitions, validateEffectSource,
	getEffectDefinitions, collectCustomNodeGraphEffectFile, encodeCustomNodeGraphEffectFile, decodeCustomNodeGraphEffectFile, prepareCustomNodeGraphEffectImport } = module.exports;
const scene = () => ({ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [] });
const inlineGraph = nodes => ({ type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: testGraph({ nodes }) });

function observeRendererState(manager, t) {
	const validation = new ProjectRenderValidation(manager.state, nativeEffectDefinitions);
	validation.reset();
	t.after(manager.onChange(changes => validation.update(changes)));
	const snapshot = () => deepClone({ customNodeGraphEffects: manager.state.customNodeGraphEffects.value,
		customShaderEffects: manager.state.customShaderEffects.value, timelineScenes: manager.state.timelineScenes.value, automationGraphs: manager.state.automationGraphs.value });
	let replica = snapshot();
	const sync = new RendererProjectSynchronizer(manager, { async apply(changes) { replica = applyRendererProjectChanges(replica, changes); }, onUpdated() {}, onError(error) { throw error; } });
	t.after(() => sync.dispose());
	return async () => {
		assert.equal(validation.errorMessage.value, null);
		await sync.flush();
		assert.deepEqual(replica, snapshot());
	};
}

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

// 【登録済みの公開入力を削除すると、全配置の引数も同じ履歴で削除・復元する】
// 編集していないノードも既定値を引数として保存する。呼び出し元に未知の引数が残るとプロジェクト全体が描画できない。
// 入れ子の定義とレイヤーには異なる値を渡し、未指定の引数や同じポートIDを持つ別定義への影響も確認する。
test('removes public arguments from every registered graph use and restores their exact bindings', async t => {
	const manager = new ProjectContext(createTestProject({ timelineScenes: [scene()] })).stateManager;
	const child = manager.commit('createCustomNodeGraphEffect', {});
	const parent = manager.commit('createCustomNodeGraphEffect', {});
	const literal = value => ({ inputSource: 'literal', value });
	const parameter = manager.commit('createCustomNodeGraphEffectPublicParameter', { customNodeGraphEffect: child, definition: {
		nameForReference: 'strength', dataType: { kind: 'scalar' }, canNode: false, ui: { label: 'Strength', control: { controlType: 'number' } }, defaultValue: literal(3),
	} });
	const { parameterId } = parameter;
	const reference = { type: 'customNodeGraphEffectReference', id: child.customNodeGraphEffectId };
	const childGraph = manager.state.customNodeGraphEffects.value[0].definition;
	const parentGraph = manager.state.customNodeGraphEffects.value[1].definition;
	const addNode = effectSource => manager.commit('createCustomNodeGraphEffectEffectNode', { customNodeGraphEffect: parent, effectSource });
	const addLayer = effectSource => {
		const { layerId } = manager.commit('createTimelineLayer', { sceneId: 'scene', layer: { layerType: 'effect', effectSource }, clips: [] });
		return manager.state.timelineScenes.value[0].layers.find(layer => layer.id === layerId);
	};
	const nested = binding => inlineGraph([{ id: 'inner', params: {}, effectSource: inlineGraph([
		{ id: 'edited', effectSource: reference, params: { [parameterId]: binding } }, { id: 'omitted', effectSource: reference, params: {} },
	]) }]);
	const directNode = addNode(reference);
	const expression = { inputSource: 'expression', expression: '0.5' };
	const nestedNode = addNode(nested(expression));
	const directLayer = addLayer(reference);
	manager.commit('setTimelineLayerParameterSource', { sceneId: 'scene', layerId: directLayer.id, parameterGroup: 'effect', parameterPath: [parameterId], source: literal(5) });
	const nestedLayer = addLayer(nested(literal(7)));
	const independentLayer = addLayer({ type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: childGraph });
	const checkRenderer = observeRendererState(manager, t);

	async function checkArguments(present) {
		const innerNodes = source => source.customNodeGraphEffect.nodes[0].effectSource.customNodeGraphEffect.nodes;
		const parentCalls = innerNodes(parentGraph.nodes.find(node => node.id === nestedNode.nodeId).effectSource);
		const layerCalls = innerNodes(nestedLayer.effectSource);
		const argumentsAtPlacements = [parentGraph.nodes.find(node => node.id === directNode.nodeId).params, parentCalls[0].params, directLayer.effectParamValues, layerCalls[0].params];
		assert.deepEqual(argumentsAtPlacements.map(values => values[parameterId]), present ? [literal(3), expression, literal(5), literal(7)] : Array(4).fill(undefined));
		assert.ok(argumentsAtPlacements.every(values => Object.hasOwn(values, parameterId) === present));
		assert.equal(Object.hasOwn(parentCalls[1].params, parameterId), false);
		assert.equal(Object.hasOwn(layerCalls[1].params, parameterId), false);
		assert.deepEqual(independentLayer.effectParamValues[parameterId], literal(3));
		await checkRenderer();
	}
	await checkArguments(true);
	manager.commit('removeCustomNodeGraphEffectPublicParameter', { target: parameter });
	await checkArguments(false);
	manager.undo();
	await checkArguments(true);
	manager.redo();
	await checkArguments(false);

	// レイヤーが独自に所有する定義からの削除は、そのレイヤー自身の引数だけを対象とする。
	manager.commit('removeCustomNodeGraphEffectPublicParameter', { target: { customNodeGraphEffect: { sceneId: 'scene', layerId: independentLayer.id }, parameterId } });
	assert.equal(Object.hasOwn(independentLayer.effectParamValues, parameterId), false);
	await checkRenderer();
	manager.undo();
	await checkArguments(false);
});

// 【Asset 削除は登録・レイヤー所有の両方でインライン定義の末端まで到達する】
// 参照の残った画像ノードはプロジェクト全体の検証を止める。同じIDのPlayerと別素材を残し、Undo/Redoも各配置へ届ける。
test('clears nested node asset settings across graph owners and restores them on undo', async t => {
	const imageAsset = id => ({ id, name: id, fileData: new Blob(), fileDataType: 'image/png', width: 2, height: 2, isExternalReference: false, sourceFilePath: null, thumbnailSequence: null });
	const image = (id, assetId) => ({ id, effectSource: { type: 'nativeEffect', id: 'image' }, params: {}, staticSettings: { image: assetId } });
	const nested = inlineGraph([{ id: 'inner', params: {}, effectSource: inlineGraph([
		image('removed', 'photo'), image('kept', 'other'), { id: 'video', effectSource: { type: 'nativeEffect', id: 'video' }, params: {}, staticSettings: { player: 'photo' } },
	]) }]);
	const manager = new ProjectContext(createTestProject({
		timelineScenes: [scene()], assets: [imageAsset('photo'), imageAsset('other')], players: [{ id: 'photo', name: 'Player', sourceType: null, assetId: null }],
		customNodeGraphEffects: [{ id: 'parent', name: 'Parent', definition: testGraph({ nodes: [
			image('direct', 'photo'), { id: 'nested', params: {}, effectSource: nested },
		] }) }],
	})).stateManager;
	const layer = manager.commit('createTimelineLayer', { sceneId: 'scene', layer: { layerType: 'effect', effectSource: nested }, clips: [] });
	const checkRenderer = observeRendererState(manager, t);
	async function checkAssets(expected) {
		const parentNodes = manager.state.customNodeGraphEffects.value[0].definition.nodes;
		const layerSource = manager.state.timelineScenes.value[0].layers.find(entry => entry.id === layer.layerId).effectSource;
		assert.equal(parentNodes[0].staticSettings.image, expected);
		for (const source of [parentNodes[1].effectSource, layerSource]) {
			const nodes = source.customNodeGraphEffect.nodes[0].effectSource.customNodeGraphEffect.nodes;
			assert.deepEqual(nodes.map(node => node.staticSettings), [{ image: expected }, { image: 'other' }, { player: 'photo' }]);
		}
		assert.deepEqual(manager.state.assets.value.map(asset => asset.id), expected == null ? ['other'] : ['photo', 'other']);
		await checkRenderer();
	}
	await checkAssets('photo');
	manager.commit('removeAsset', { assetId: 'photo' });
	await checkAssets(null);
	manager.undo();
	await checkAssets('photo');
	manager.redo();
	await checkAssets(null);
});

// 【ノード追加 Command は登録グラフへの直接・間接の循環を履歴に残さない】
// ピッカーを経由しないスクリプトや選択待ちの間の編集でも、インライン定義を介した循環を作れないようにする。
test('rejects direct and nested graph reference cycles before recording a node edit', () => {
	const manager = new ProjectContext(createTestProject()).stateManager;
	const parent = manager.commit('createCustomNodeGraphEffect', {});
	const child = manager.commit('createCustomNodeGraphEffect', {});
	const reference = target => ({ type: 'customNodeGraphEffectReference', id: target.customNodeGraphEffectId });
	const add = (customNodeGraphEffect, effectSource) => manager.commit('createCustomNodeGraphEffectEffectNode', { customNodeGraphEffect, effectSource });
	const wrap = effectSource => ({ type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: testGraph({ nodes: [{ id: 'nested', effectSource, params: {} }] }) });
	add(parent, wrap(reference(child)));
	const historyLength = manager.undoStack.value.length;
	for (const candidate of [reference(child), reference(parent), wrap(reference(parent))]) {
		assert.throws(() => add(child, candidate), /Cyclic Custom Node Graph Effect reference/);
	}
	assert.equal(manager.undoStack.value.length, historyLength);
	manager.undo();
	add(child, reference(parent));
	assert.deepEqual(manager.state.customNodeGraphEffects.value[1].definition.nodes[0].effectSource, reference(parent));
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
