import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createTestProject } from './helpers/project.mjs';
import { testNodesEffect } from './helpers/nodes-effect.mjs';

const directory = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({
	absWorkingDir: directory, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'],
	stdin: { loader: 'ts', resolveDir: directory, contents: `
		export { ProjectContext } from './src/Project.ts';
		export { ProjectRenderValidation } from './src/ProjectRenderValidation.ts';
		export { deepClone } from '@gs/shared/utility/deep-clone.ts';
		export { RendererProjectSynchronizer } from './src/RendererProjectSynchronizer.ts';
		export { applyRendererProjectChanges } from '@gs/glitch-studio_shared/project/renderer-state.ts';
		export { collectNodesEffectFile, encodeNodesEffectFile, decodeNodesEffectFile, prepareNodesEffectImport } from './src/nodes-effect-file-codec.ts';
		export { nativeEffectDefinitions } from '@gs/subsystems_effect_native-effects/definitions.ts';
		export { validateEffectSource } from '@gs/subsystems_effect_shared/validate-effect-source.ts';
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
	getEffectDefinitions, collectNodesEffectFile, encodeNodesEffectFile, decodeNodesEffectFile, prepareNodesEffectImport } = module.exports;
const scene = () => ({ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [] });
const inlineNodesEffectSource = nodes => ({ type: 'inlineNodesEffect', nodesEffect: testNodesEffect({ nodes }) });

function observeRendererState(manager, t) {
	const validation = new ProjectRenderValidation(manager.state, nativeEffectDefinitions);
	validation.reset();
	t.after(manager.onChange(changes => validation.update(changes)));
	const snapshot = () => deepClone({ nodesEffects: manager.state.nodesEffects.value,
		customShaderEffects: manager.state.customShaderEffects.value, timelineScenes: manager.state.timelineScenes.value, curveAnimations: manager.state.curveAnimations.value });
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
	const target = manager.commit('createNodesEffect', {});
	const entry = manager.state.nodesEffects.value[0];
	const relay = manager.commit('createNodesEffectRelayNode', { nodesEffect: target });
	const parameterId = entry.definition.primaryInputParameter;
	const outputId = entry.definition.primaryOutput;
	manager.commit('setNodesEffectRelayInput', { target: relay, source: { nodeId: 'globalIn', outputPort: parameterId } });
	manager.commit('setNodesEffectOutputConnection', { target: { nodesEffect: target, outputId }, source: { nodeId: relay.nodeId, outputPort: 'output' } });
	const read = () => entry.definition;
	assert.deepEqual(read().nodes.map(node => node.type), ['relay']);
	assert.deepEqual(read().nodes[0].input, { parameterId });
	assert.deepEqual(read().outputSources[outputId], { nodeId: relay.nodeId, outputPort: 'output' });
	validateEffectSource({ type: 'nodesEffectReference', id: entry.id }, getEffectDefinitions(manager.state));
	manager.undo();
	assert.equal(read().outputSources[outputId], undefined);
	manager.redo();
	assert.deepEqual(read().outputSources[outputId], { nodeId: relay.nodeId, outputPort: 'output' });
	manager.commit('removeNodesEffectOutput', { target: { nodesEffect: target, outputId } });
	assert.equal(read().outputSources[outputId], undefined);
	manager.undo();
	assert.deepEqual(read().outputSources[outputId], { nodeId: relay.nodeId, outputPort: 'output' });
});

// 【登録グラフの出力削除を利用側の切断とともにUndo/Redoする】
// 親グラフの公開出力・Relay・配列やstructの入力に削除済みのポート参照が残ると描画検証が失敗する。
// インラインの入れ子も含めて同じ差分でWorkerに同期し、別の出力と同じポートIDの別定義は保持する。
test('disconnects consumers of a removed registered Nodes Effect output and restores their wiring', async t => {
	const color = { dataType: { kind: 'color' } };
	const literal = value => ({ inputSource: 'literal', value });
	const reference = id => ({ type: 'nodesEffectReference', id });
	const output = (nodeId, outputPort) => ({ nodeId, outputPort });
	const sampling = { fitMode: 'contain', wrapMode: 'clamp', filterMode: 'nearest' };
	const connected = source => ({ inputSource: 'node', source, sampling });
	const sourceDefinition = testNodesEffect({
		primaryOutput: 'removed', outputDefs: { removed: color, kept: color },
		nodes: [{ id: 'fill', effectSource: { type: 'nativeEffect', id: 'fill' }, params: {} }],
		outputSources: { removed: output('fill', 'output'), kept: output('fill', 'output') },
	});
	const consumerNodesEffect = () => testNodesEffect({
		outputDefs: { output: color, viaRelay: color, otherNodesEffect: color, otherPort: color },
		nodes: [
			{ id: 'source', effectSource: reference('child'), params: {} },
			{ id: 'secondUse', effectSource: reference('child'), params: {} },
			{ id: 'other', effectSource: reference('other'), params: {} },
			{ id: 'relay', type: 'relay', dataType: color.dataType, input: output('source', 'removed') },
			{ id: 'consumer', effectSource: { type: 'nativeEffect', id: 'testStructArray' }, params: {
				foo: literal({ node: connected(output('secondUse', 'removed')) }),
				buzzs: literal([
					{ id: 'removed', binding: literal({ image: connected(output('source', 'removed')), x: literal(0.5), y: literal(0) }) },
					{ id: 'kept', binding: literal({ image: connected(output('source', 'kept')), x: literal(0), y: literal(0) }) },
				]),
			} },
		],
		outputSources: { output: output('source', 'removed'), viaRelay: output('relay', 'output'), otherNodesEffect: output('other', 'removed'), otherPort: output('source', 'kept') },
	});
	const createNestedNodesEffectNode = () => ({ id: 'nested', effectSource: { type: 'inlineNodesEffect', nodesEffect: consumerNodesEffect() }, params: {} });
	const parentDefinition = consumerNodesEffect();
	parentDefinition.nodes.push(createNestedNodesEffectNode());
	const manager = new ProjectContext(createTestProject({
		timelineScenes: [scene()], nodesEffects: [
			{ id: 'child', name: 'Child', definition: sourceDefinition },
			{ id: 'other', name: 'Other', definition: structuredClone(sourceDefinition) },
			{ id: 'parent', name: 'Parent', definition: parentDefinition },
		],
	})).stateManager;
	const { layerId } = manager.commit('createTimelineLayer', { sceneId: 'scene', layer: { layerType: 'effect', effectSource: inlineNodesEffectSource([createNestedNodesEffectNode()]) }, clips: [] });
	const [child, other, parent] = manager.state.nodesEffects.value;
	const readLayerNodesEffect = () => manager.state.timelineScenes.value[0].layers.find(layer => layer.id === layerId).effectSource.nodesEffect;
	const snapshot = () => deepClone([child.definition, other.definition, parent.definition, readLayerNodesEffect()]);
	const before = snapshot();
	const checkRenderer = observeRendererState(manager, t);
	await checkRenderer();

	const historyLength = manager.undoStack.value.length;
	manager.commit('removeNodesEffectOutput', { target: { nodesEffect: { nodesEffectId: child.id }, outputId: 'removed' } });
	assert.equal(manager.undoStack.value.length, historyLength + 1);
	assert.equal(child.definition.primaryOutput, null);
	assert.equal(Object.hasOwn(child.definition.outputDefs, 'removed'), false);
	assert.deepEqual(child.definition.outputSources, { kept: output('fill', 'output') });
	assert.deepEqual(other.definition, before[1]);
	const readNestedNodesEffect = nodesEffect => nodesEffect.nodes.find(node => node.id === 'nested').effectSource.nodesEffect;
	for (const nodesEffect of [parent.definition, readNestedNodesEffect(parent.definition), readNestedNodesEffect(readLayerNodesEffect())]) {
		assert.ok(Object.hasOwn(nodesEffect.outputDefs, 'output'));
		assert.deepEqual(nodesEffect.outputSources, { viaRelay: output('relay', 'output'), otherNodesEffect: output('other', 'removed'), otherPort: output('source', 'kept') });
		assert.equal(nodesEffect.nodes.find(node => node.id === 'relay').input, null);
		const { foo, buzzs } = nodesEffect.nodes.find(node => node.id === 'consumer').params;
		assert.deepEqual(foo.value.node, connected(null));
		assert.deepEqual(buzzs.value[0].binding.value, { image: connected(null), x: literal(0.5), y: literal(0) });
		assert.deepEqual(buzzs.value[1].binding.value.image, connected(output('source', 'kept')));
	}
	const after = snapshot();
	await checkRenderer();
	manager.undo();
	assert.deepEqual(snapshot(), before);
	await checkRenderer();
	manager.redo();
	assert.deepEqual(snapshot(), after);
	await checkRenderer();
});

// 【公開入力の削除をUndoすると自動解像度の参照も復元する】
// ポートIDだけを復元すると、Undo後に同じ画像へ繋ぎ直しても描画寸法が変わってしまう。
test('restores the resolution input when undoing removal of the primary public input', () => {
	const manager = new ProjectContext(createTestProject()).stateManager;
	const target = manager.commit('createNodesEffect', {});
	const { definition } = manager.state.nodesEffects.value[0];
	const parameterId = definition.primaryInputParameter;
	manager.commit('removeNodesEffectPublicParameter', { target: { nodesEffect: target, parameterId } });
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
test('removes public arguments from every use of a registered Nodes Effect and restores their exact bindings', async t => {
	const manager = new ProjectContext(createTestProject({ timelineScenes: [scene()] })).stateManager;
	const child = manager.commit('createNodesEffect', {});
	const parent = manager.commit('createNodesEffect', {});
	const literal = value => ({ inputSource: 'literal', value });
	const parameter = manager.commit('createNodesEffectPublicParameter', { nodesEffect: child, definition: {
		nameForReference: 'strength', dataType: { kind: 'scalar' }, canNode: false, ui: { label: 'Strength', control: { controlType: 'number' } }, defaultValue: 3,
	} });
	const { parameterId } = parameter;
	const reference = { type: 'nodesEffectReference', id: child.nodesEffectId };
	const childNodesEffect = manager.state.nodesEffects.value[0].definition;
	const parentNodesEffect = manager.state.nodesEffects.value[1].definition;
	const addNode = effectSource => manager.commit('createNodesEffectEffectNode', { nodesEffect: parent, effectSource });
	const addLayer = effectSource => {
		const { layerId } = manager.commit('createTimelineLayer', { sceneId: 'scene', layer: { layerType: 'effect', effectSource }, clips: [] });
		return manager.state.timelineScenes.value[0].layers.find(layer => layer.id === layerId);
	};
	const nested = binding => inlineNodesEffectSource([{ id: 'inner', params: {}, effectSource: inlineNodesEffectSource([
		{ id: 'edited', effectSource: reference, params: { [parameterId]: binding } }, { id: 'omitted', effectSource: reference, params: {} },
	]) }]);
	const directNode = addNode(reference);
	const expression = { inputSource: 'expression', expression: '0.5' };
	const nestedNode = addNode(nested(expression));
	const directLayer = addLayer(reference);
	manager.commit('setTimelineLayerParameterSource', { sceneId: 'scene', layerId: directLayer.id, parameterGroup: 'effect', parameterPath: [parameterId], source: literal(5) });
	const nestedLayer = addLayer(nested(literal(7)));
	const independentLayer = addLayer({ type: 'inlineNodesEffect', nodesEffect: childNodesEffect });
	const checkRenderer = observeRendererState(manager, t);

	async function checkArguments(present) {
		const innerNodes = source => source.nodesEffect.nodes[0].effectSource.nodesEffect.nodes;
		const parentCalls = innerNodes(parentNodesEffect.nodes.find(node => node.id === nestedNode.nodeId).effectSource);
		const layerCalls = innerNodes(nestedLayer.effectSource);
		const argumentsAtPlacements = [parentNodesEffect.nodes.find(node => node.id === directNode.nodeId).params, parentCalls[0].params, directLayer.effectParamValues, layerCalls[0].params];
		assert.deepEqual(argumentsAtPlacements.map(values => values[parameterId]), present ? [literal(3), expression, literal(5), literal(7)] : Array(4).fill(undefined));
		assert.ok(argumentsAtPlacements.every(values => Object.hasOwn(values, parameterId) === present));
		assert.equal(Object.hasOwn(parentCalls[1].params, parameterId), false);
		assert.equal(Object.hasOwn(layerCalls[1].params, parameterId), false);
		assert.deepEqual(independentLayer.effectParamValues[parameterId], literal(3));
		await checkRenderer();
	}
	await checkArguments(true);
	manager.commit('removeNodesEffectPublicParameter', { target: parameter });
	await checkArguments(false);
	manager.undo();
	await checkArguments(true);
	manager.redo();
	await checkArguments(false);

	// レイヤーが独自に所有する定義からの削除は、そのレイヤー自身の引数だけを対象とする。
	manager.commit('removeNodesEffectPublicParameter', { target: { nodesEffect: { sceneId: 'scene', layerId: independentLayer.id }, parameterId } });
	assert.equal(Object.hasOwn(independentLayer.effectParamValues, parameterId), false);
	await checkRenderer();
	manager.undo();
	await checkArguments(false);
});

// 【登録済みの公開入力でノード接続を無効にすると、利用側の画像Bindingを解除する】
// 親グラフのInからの接続やインライン定義の入れ子も対象になる。色の固定値とCPU値の参照は引き続き有効なので保持する。
// 定義と引数を同じ履歴で扱い、検証やWorkerに古いBindingが残らないことをUndo/Redoも含めて確認する。
test('clears texture arguments when a registered public parameter stops accepting node input', async t => {
	const literal = value => ({ inputSource: 'literal', value });
	const image = { nameForReference: 'image', dataType: { kind: 'color' }, canNode: true, ui: { label: 'Image', control: {} }, defaultValue: [0, 0, 0, 0] };
	const child = testNodesEffect({ paramDefs: { image }, primaryInputParameter: 'image', resolutionInputParameters: ['image'] });
	const reference = { type: 'nodesEffectReference', id: 'child' };
	const sampling = { fitMode: 'contain', wrapMode: 'clamp', filterMode: 'nearest' };
	const wire = { inputSource: 'node', source: { nodeId: 'fill', outputPort: 'output' }, sampling };
	const publicReference = parameterId => ({ inputSource: 'nodesEffectPublicParameterReference', parameterId });
	const call = (id, binding) => ({ id, effectSource: reference, params: { image: binding } });
	const fill = { id: 'fill', effectSource: { type: 'nativeEffect', id: 'fill' }, params: {} };
	const fixedColor = literal([1, 0, 0, 1]);
	const parent = testNodesEffect({
		paramDefs: { image, color: { ...image, nameForReference: 'color', canNode: false } },
		nodes: [fill, call('wired', wire), call('image', publicReference('image')), call('color', publicReference('color')), call('literal', fixedColor)],
	});
	const manager = new ProjectContext(createTestProject({ timelineScenes: [scene()], nodesEffects: [
		{ id: 'child', name: 'Child', definition: child }, { id: 'parent', name: 'Parent', definition: parent },
	] })).stateManager;
	const addLayer = effectSource => {
		const { layerId } = manager.commit('createTimelineLayer', { sceneId: 'scene', layer: { layerType: 'effect', effectSource }, clips: [] });
		return manager.state.timelineScenes.value[0].layers.find(layer => layer.id === layerId);
	};
	const lowerLayer = addLayer(reference);
	const explicitLayer = addLayer(reference);
	manager.commit('setTimelineLayerParameterSource', { sceneId: 'scene', layerId: explicitLayer.id, parameterGroup: 'effect', parameterPath: ['image'],
		source: { inputSource: 'anotherLayerOutput', layerId: lowerLayer.id, outputStage: 'source', sampling } });
	const inlineLayer = addLayer(inlineNodesEffectSource([fill, call('nested', wire)]));
	const checkRenderer = observeRendererState(manager, t);
	const snapshot = () => deepClone([manager.state.nodesEffects.value, manager.state.timelineScenes.value]);
	const before = snapshot();
	await checkRenderer();

	manager.commit('replaceNodesEffectPublicParameterDefinition', {
		target: { nodesEffect: { nodesEffectId: 'child' }, parameterId: 'image' }, definition: { ...image, canNode: false },
	});
	const [childEntry, parentEntry] = manager.state.nodesEffects.value;
	assert.equal(childEntry.definition.primaryInputParameter, null);
	assert.deepEqual(childEntry.definition.resolutionInputParameters, []);
	const args = id => parentEntry.definition.nodes.find(node => node.id === id).params;
	assert.deepEqual(args('wired'), {});
	assert.deepEqual(args('image'), {});
	assert.deepEqual(args('color'), { image: publicReference('color') });
	assert.deepEqual(args('literal'), { image: fixedColor });
	assert.equal(Object.hasOwn(lowerLayer.effectParamValues, 'image'), false);
	assert.equal(Object.hasOwn(explicitLayer.effectParamValues, 'image'), false);
	assert.deepEqual(inlineLayer.effectSource.nodesEffect.nodes.find(node => node.id === 'nested').params, {});
	await checkRenderer();
	const after = snapshot();
	manager.undo();
	assert.deepEqual(snapshot(), before);
	await checkRenderer();
	manager.redo();
	assert.deepEqual(snapshot(), after);
	await checkRenderer();
});

// 【インライン定義の公開引数では、無効になった配列内のBindingだけを初期値へ戻す】
// 配列要素のIDと兄弟フィールドは別の編集に使うため、画像の接続を外す操作で失わない。
// 引数全体の型を変えた場合も同じ履歴で旧引数を解除し、所有レイヤーに新しい定義を同期する。
test('updates incompatible arguments on the Timeline layer that owns an inline definition', async t => {
	const literal = value => ({ inputSource: 'literal', value });
	const image = { canNode: true, defaultValue: [0, 0, 0, 0] };
	const amount = { defaultValue: 0 };
	const defaultElement = { image: image.defaultValue, amount: amount.defaultValue };
	const settings = { nameForReference: 'settings', canNode: false, dataType: { kind: 'array', elementType: {
		kind: 'struct', fields: { image: { kind: 'color' }, amount: { kind: 'scalar' } },
	} }, ui: { label: 'Settings', control: { element: { fields: {
		image: { label: 'Image', control: {} }, amount: { label: 'Amount', control: { controlType: 'number' } },
	} } } }, element: { fields: { image, amount }, defaultValue: defaultElement }, defaultValue: [defaultElement] };
	const manager = new ProjectContext(createTestProject({ timelineScenes: [scene()] })).stateManager;
	const { layerId } = manager.commit('createTimelineLayer', { sceneId: 'scene', clips: [], layer: { layerType: 'effect',
		effectSource: { type: 'inlineNodesEffect', nodesEffect: testNodesEffect({ paramDefs: { settings } }) },
	} });
	const target = { nodesEffect: { sceneId: 'scene', layerId }, parameterId: 'settings' };
	const layer = manager.state.timelineScenes.value[0].layers[0];
	const elementId = layer.effectParamValues.settings.value[0].id;
	const updateField = (field, source) => manager.commit('setTimelineLayerParameterSource', {
		sceneId: 'scene', layerId, parameterGroup: 'effect', parameterPath: ['settings', elementId, field], source,
	});
	updateField('image', { inputSource: 'lowerLayerOutput' });
	updateField('amount', literal(0.75));
	const checkRenderer = observeRendererState(manager, t);
	const before = deepClone(layer.effectParamValues.settings);
	await checkRenderer();

	manager.commit('replaceNodesEffectPublicParameterDefinition', { target, definition: {
		...settings, element: { ...settings.element, fields: { image: { ...image, canNode: false }, amount } },
	} });
	const adjusted = literal([{ id: elementId, binding: literal({ image: literal(image.defaultValue), amount: literal(0.75) }) }]);
	assert.deepEqual(layer.effectParamValues.settings, adjusted);
	await checkRenderer();
	manager.undo();
	assert.deepEqual(layer.effectParamValues.settings, before);
	await checkRenderer();
	manager.redo();
	assert.deepEqual(layer.effectParamValues.settings, adjusted);
	await checkRenderer();

	manager.commit('replaceNodesEffectPublicParameterDefinition', { target, definition: {
		nameForReference: 'settings', canNode: false, dataType: { kind: 'scalar' }, ui: { label: 'Settings', control: { controlType: 'number' } }, defaultValue: 1,
	} });
	assert.equal(Object.hasOwn(layer.effectParamValues, 'settings'), false);
	await checkRenderer();
	manager.undo();
	assert.deepEqual(layer.effectParamValues.settings, adjusted);
	await checkRenderer();
});

// 【Asset 削除は登録・レイヤー所有の両方でインライン定義の末端まで到達する】
// 参照の残った画像ノードはプロジェクト全体の検証を止める。別素材を残し、Undo/Redoも各配置へ届ける。
test('clears nested node asset settings across Nodes Effect owners and restores them on undo', async t => {
	const imageAsset = id => ({ id, name: id, fileData: new Blob(), fileDataType: 'image/png', width: 2, height: 2, isExternalReference: false, sourceFilePath: null, thumbnailSequence: null });
	const image = (id, assetId) => ({ id, effectSource: { type: 'nativeEffect', id: 'image' }, params: {}, staticSettings: { image: assetId } });
	const nested = inlineNodesEffectSource([{ id: 'inner', params: {}, effectSource: inlineNodesEffectSource([
		image('removed', 'photo'), image('kept', 'other'),
	]) }]);
	const manager = new ProjectContext(createTestProject({
		timelineScenes: [scene()], assets: [imageAsset('photo'), imageAsset('other')],
		nodesEffects: [{ id: 'parent', name: 'Parent', definition: testNodesEffect({ nodes: [
			image('direct', 'photo'), { id: 'nested', params: {}, effectSource: nested },
		] }) }],
	})).stateManager;
	const layer = manager.commit('createTimelineLayer', { sceneId: 'scene', layer: { layerType: 'effect', effectSource: nested }, clips: [] });
	const checkRenderer = observeRendererState(manager, t);
	async function checkAssets(expected) {
		const parentNodes = manager.state.nodesEffects.value[0].definition.nodes;
		const layerSource = manager.state.timelineScenes.value[0].layers.find(entry => entry.id === layer.layerId).effectSource;
		assert.equal(parentNodes[0].staticSettings.image, expected);
		for (const source of [parentNodes[1].effectSource, layerSource]) {
			const nodes = source.nodesEffect.nodes[0].effectSource.nodesEffect.nodes;
			assert.deepEqual(nodes.map(node => node.staticSettings), [{ image: expected }, { image: 'other' }]);
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
test('rejects direct and nested Nodes Effect reference cycles before recording a node edit', () => {
	const manager = new ProjectContext(createTestProject()).stateManager;
	const parent = manager.commit('createNodesEffect', {});
	const child = manager.commit('createNodesEffect', {});
	const reference = target => ({ type: 'nodesEffectReference', id: target.nodesEffectId });
	const add = (nodesEffect, effectSource) => manager.commit('createNodesEffectEffectNode', { nodesEffect, effectSource });
	const wrap = effectSource => ({ type: 'inlineNodesEffect', nodesEffect: testNodesEffect({ nodes: [{ id: 'nested', effectSource, params: {} }] }) });
	add(parent, wrap(reference(child)));
	const historyLength = manager.undoStack.value.length;
	for (const candidate of [reference(child), reference(parent), wrap(reference(parent))]) {
		assert.throws(() => add(child, candidate), /Cyclic Nodes Effect reference/);
	}
	assert.equal(manager.undoStack.value.length, historyLength);
	manager.undo();
	add(child, reference(parent));
	assert.deepEqual(manager.state.nodesEffects.value[1].definition.nodes[0].effectSource, reference(parent));
});

// 【Native・参照・インラインの配置を同じTimeline Commandで作成する】
// 同じ種類のレイヤーとして作成・同期され、登録IDとインライン定義をそのまま取り出せることを確認する。
test('creates all five Effect sources through the Timeline command and synchronizes them', async t => {
	const project = createTestProject({ timelineScenes: [scene()] });
	const manager = new ProjectContext(project).stateManager;
	let replica = structuredClone({ curveAnimations: [], nodesEffects: [], customShaderEffects: [], timelineScenes: [scene()] });
	const sync = new RendererProjectSynchronizer(manager, { async apply(changes) { replica = applyRendererProjectChanges(replica, changes); }, onUpdated() {}, onError(error) { throw error; } });
	t.after(() => sync.dispose());
	const { customShaderEffectId } = manager.commit('createCustomShaderEffect', {});
	const { nodesEffectId } = manager.commit('createNodesEffect', {});
	const sources = [
		{ type: 'nativeEffect', id: 'fill' }, { type: 'customShaderEffectReference', id: customShaderEffectId },
		{ type: 'inlineCustomShaderEffect', customShaderEffect: manager.state.customShaderEffects.value[0].definition },
		{ type: 'nodesEffectReference', id: nodesEffectId },
		{ type: 'inlineNodesEffect', nodesEffect: manager.state.nodesEffects.value[0].definition },
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
	const target = manager.commit('createNodesEffect', {});
	const node = manager.commit('createNodesEffectEffectNode', { nodesEffect: target, effectSource: { type: 'customShaderEffectReference', id: customShaderEffectId }, connectionMode: 'appendToPrimaryOutput' });
	manager.commit('setNodesEffectNodeDisplayName', { target: node, displayName: 'Lens' });
	const project = manager.state;
	const entry = project.nodesEffects.value[0];
	const file = collectNodesEffectFile({ gsVersion: '1.0.0', name: entry.name, nodesEffect: entry.definition, nodeMetadata: entry.nodeMetadata,
		nodesEffects: project.nodesEffects.value, customShaderEffects: project.customShaderEffects.value, assets: [] }, nativeEffectDefinitions);
	const imported = prepareNodesEffectImport(decodeNodesEffectFile(await encodeNodesEffectFile(file), '1.0.0'), nativeEffectDefinitions);
	const receiver = new ProjectContext(createTestProject()).stateManager;
	receiver.commit('importNodesEffect', imported);
	assert.equal(imported.nodesEffect.nodeMetadata[node.nodeId].displayName, 'Lens');
	assert.equal(imported.nodesEffect.definition.nodes[0].effectSource.id, receiver.state.customShaderEffects.value[0].id);
	assert.notEqual(imported.nodesEffect.definition.nodes[0].effectSource.id, customShaderEffectId);
	receiver.undo();
	assert.equal(receiver.state.customShaderEffects.value.length, 0);
	assert.equal(receiver.state.nodesEffects.value.length, 0);
	receiver.redo();
	assert.equal(receiver.state.customShaderEffects.value.length, 1);
});
