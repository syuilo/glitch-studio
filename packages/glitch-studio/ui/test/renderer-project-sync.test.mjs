import { createDefaultParameterBinding } from '@gs/shared/parameter/parameter-default.ts';
import { testNodesEffect } from './helpers/nodes-effect.mjs';
import { nodeParameterTarget, customParameterTarget, nodeTarget, timelineParameterTarget } from './helpers/command-inputs.mjs';
import { createTestProject } from './helpers/project.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const directory = fileURLToPath(new URL('../', import.meta.url));
// コマンド・履歴・差分生成は実コード。ブラウザ依存の設定とエフェクト登録だけを置き換える。
const bundle = await build({
	stdin: { resolveDir: directory, loader: 'ts', contents: `
		export { ExpressionEvaluator } from '@gs/shared/expression/expression-evaluator.ts';
		export { ProjectContext } from './src/Project.ts';
		export { getAvailableCurveAnimations, getTimelineScenesWithProjectCurveAnimations } from '@gs/glitch-studio_shared/project/curve-animations.ts';
		export { ParameterBindingEvaluator } from '@gs/shared/parameter/parameter-binding-evaluator.ts';
		export { TimelineAudioRenderer } from '@gs/subsystems_timeline_audio-renderer/timeline-audio-renderer.ts';
		export { getSceneAudioClips } from '@gs/subsystems_timeline_shared/scene-audio.ts';
		export { createProjectCurveAnimation } from './src/utility/curve-animation.ts';
		export { encodeProjectFile, decodeProjectFile } from './src/gsproj.ts';
		export { RendererProjectSynchronizer } from './src/RendererProjectSynchronizer.ts';
		export { applyRendererProjectChanges } from '@gs/glitch-studio_shared/project/renderer-state.ts';
		export { default as definition } from '@gs/subsystems_effect_native-effects/fx/testStructArray/_def_.ts';
		export { createEffectTimelineLayer } from './src/utility/effect-timeline-layer.ts';
		export { createInlineNodesEffectLayer } from './src/utility/inline-nodes-effect-layer.ts';
		export { createCameraTimelineLayer } from './src/utility/camera-timeline-layer.ts';
		export { createProjectCustomShaderEffect } from './src/utility/custom-shader-effect.ts';
		export { getEffectDefinitions } from './src/utility/project-effects.ts';
		export const customShaderEffectReference = id => ({ type: 'customShaderEffectReference', id });
		export { createImageLayer } from './src/utility/image-layer.ts';
	` },
	absWorkingDir: directory, bundle: true, platform: 'node', format: 'cjs', write: false,
	plugins: [{ name: 'sync-test', setup(build) {
		build.onResolve({ filter: /(?:effect-definitions|native-effects[\\/]definitions)\.[jt]s$|preferences\.ts$/ }, args => ({ path: args.path, namespace: 'test' }));
		build.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({ loader: 'ts', resolveDir: directory,
			contents: path.endsWith('preferences.ts') ? 'export const preferences = { s: { forceTypeSafety: false } };'
				: "import definition from '@gs/subsystems_effect_native-effects/fx/testStructArray/_def_.ts'; export const nativeEffectDefinitions = { testStructArray: definition };",
		}));
	} }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', 'console', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports, { ...console, log() {} });
const { ExpressionEvaluator, ProjectContext, RendererProjectSynchronizer, applyRendererProjectChanges, definition,
	createEffectTimelineLayer, createInlineNodesEffectLayer, createImageLayer, createCameraTimelineLayer,
	createProjectCustomShaderEffect, getEffectDefinitions, customShaderEffectReference } = module.exports;
const defaultBuzzId = createDefaultParameterBinding(definition.paramDefs.buzzs).value[0].id;

function fixture(t, count = 1, overrides = {}) {
	const manager = new ProjectContext(createTestProject()).stateManager;
	const nodes = Array.from({ length: count }, (_, i) => ({
		id: 'node-' + i, type: 'effect', effectSource: { type: 'nativeEffect', id: 'testStructArray' }, pos: { x: 0, y: 0 }, isBypass: false, resolution: { mode: 'auto', scale: 1 },
		params: Object.fromEntries(Object.entries(definition.paramDefs).map(([key, def]) => [key, createDefaultParameterBinding(def)])),
	}));
	const nodesEffect = { id: 'nodesEffect', name: 'Nodes Effect', definition: testNodesEffect({ customParameterValues: {}, nodes, primaryInputParameter: null, curveAnimations: [] }) };
	const scene = { id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [] };
	manager.state.nodesEffects.value = [nodesEffect];
	manager.state.timelineScenes.value = [scene];
	let replica = structuredClone({ curveAnimations: [], customShaderEffects: [], nodesEffects: [nodesEffect], timelineScenes: [scene] });
	const batches = [], errors = [];
	const sync = new RendererProjectSynchronizer(manager, {
		apply: async changes => { batches.push(changes); replica = applyRendererProjectChanges(replica, changes); },
		onUpdated() {}, onError: error => errors.push(error), ...overrides,
	});
	t.after(() => sync.dispose());
	const target = { nodesEffectId: 'nodesEffect', nodeId: 'node-0', paramPath: ['buzzs', defaultBuzzId, 'x'] };
	const value = state => state.nodesEffects[0].definition.nodes[0].params.buzzs.value[0].binding.value.x.value;
	return { manager, sync, target, batches, errors, value: () => value(replica), get replica() { return replica; } };
}

// 【Custom Shader Effectの定義と補正済みの全配置を一つの更新で同期する】
// 定義だけ送ると旧Bindingが残り、配置だけ送ると新しい型・出力へ解決できない。
// 同じターンの通常編集も全量へ含め、Undo/Redoでも新旧の組み合わせを作らないことを確認する。
test('synchronizes shader definitions and reconciled placements atomically through undo and redo', async t => {
	const f = fixture(t);
	const customShaderEffect = createProjectCustomShaderEffect([]);
	customShaderEffect.definition.paramDefs.amount = { nameForReference: 'amount', canNode: true, dataType: { kind: 'scalar' }, ui: { label: 'Amount', control: { controlType: 'number' } }, defaultValue: 0.25 };
	customShaderEffect.definition.outputDefs.mask = { nameForReference: 'mask', label: 'Mask', dataType: { kind: 'scalar' } };
	f.manager.commit('insertCustomShaderEffect', { definition: customShaderEffect });
	const { nodeId: shaderNodeId } = f.manager.commit('createNodesEffectEffectNode', { nodesEffect: { nodesEffectId: 'nodesEffect' }, effectSource: customShaderEffectReference(customShaderEffect.id) });
	await f.sync.flush();
	assert.equal(f.batches.length, 1);
	assert.deepEqual(f.batches[0].map(change => change.type), ['customShaderEffectRegistration', 'nodesEffect']);
	const nodesEffect = f.manager.state.nodesEffects.value[0];
	nodesEffect.definition.nodes.find(node => node.id === shaderNodeId).params.amount.value = 0.75;
	nodesEffect.definition.nodes.push({ id: 'relay', type: 'relay', dataType: { kind: 'scalar' }, input: { nodeId: shaderNodeId, outputPort: 'mask' } });
	const layer = createEffectTimelineLayer(getEffectDefinitions(f.manager.state).describe(customShaderEffectReference(customShaderEffect.id)), 0);
	layer.effectParamValues.amount = { inputSource: 'literal', value: 0.8 };
	const inline = createInlineNodesEffectLayer(0);
	inline.effectSource.nodesEffect = JSON.parse(JSON.stringify(nodesEffect.definition));
	f.manager.commit('insertImportedAssets', { assets: [], timeline: { sceneId: 'scene', layers: [layer, inline] } });
	await f.sync.flush();
	const updated = structuredClone(customShaderEffect);
	updated.definition.paramDefs.amount = { ...updated.definition.paramDefs.amount, dataType: { kind: 'vector' }, ui: { label: 'Amount', control: { controlType: 'vector' } }, defaultValue: [0.1, 0.2] };
	delete updated.definition.outputDefs.mask;
	f.manager.commit('setNodesEffectNodeParameterSource', { ...nodeParameterTarget({ ...f.target }), source: { inputSource: 'literal', value: 0.6 } });
	f.manager.commit('replaceCustomShaderEffectDefinition', { customShaderEffectId: (updated).id, definition: updated });
	await f.sync.flush();
	assert.deepEqual(f.batches.at(-1).map(change => change.type), ['customShaderEffectRegistration', 'nodesEffect', 'layer', 'layer']);
	assert.equal(f.replica.customShaderEffects[0].definition.paramDefs.amount.dataType.kind, 'vector');
	assert.equal(f.value(), 0.6);
	for (const current of [f.replica.nodesEffects[0].definition, f.replica.timelineScenes[0].layers.find(layer => layer.effectSource.type === 'inlineNodesEffect').effectSource.nodesEffect]) {
		assert.deepEqual(current.nodes.find(node => node.id === shaderNodeId).params.amount.value, [0.1, 0.2]);
		assert.deepEqual(current.nodes.find(node => node.id === 'relay').input, null);
	}
	assert.deepEqual(f.replica.timelineScenes[0].layers[0].effectParamValues.amount.value, [0.1, 0.2]);
	f.manager.undo();
	await f.sync.flush();
	assert.equal(f.replica.customShaderEffects[0].definition.paramDefs.amount.dataType.kind, 'scalar');
	assert.equal(f.replica.nodesEffects[0].definition.nodes.find(node => node.id === shaderNodeId).params.amount.value, 0.75);
	assert.equal(f.replica.timelineScenes[0].layers[0].effectParamValues.amount.value, 0.8);
	f.manager.redo();
	await f.sync.flush();
	assert.equal(f.replica.customShaderEffects[0].definition.paramDefs.amount.dataType.kind, 'vector');
	assert.deepEqual(f.errors, []);
});

// 【カスタム値だけの同期でも、同時に行ったノードの構造変更を失わない】
// 値編集のスナップショットが接続・解像度変更の通知を吸収すると、GPU履歴の破棄範囲を誤る。
// 定義変更との合流でも、最後の値編集だけを理由に静的状態を維持しないことを確認する。
test('synchronizes custom values without hiding structural edits in the same batch', async t => {
	const f = fixture(t);
	const definition = { id: 'speed', nameForReference: 'speed', canNode: false, dataType: { kind: 'scalar' }, ui: { label: 'Speed', control: { controlType: 'number' } }, defaultValue: 1 };
	const { parameterId } = f.manager.commit('createNodesEffectCustomParameter', { nodesEffect: { nodesEffectId: 'nodesEffect' }, definition });
	await f.sync.flush();
	f.manager.commit('setNodesEffectCustomParameterSource', { target: customParameterTarget({ nodesEffectId: 'nodesEffect', parameterId }), source: { inputSource: 'literal', value: 2 } });
	await f.sync.flush();
	assert.equal(f.batches.at(-1)[0].customParameterValuesOnly, true);
	assert.deepEqual(Object.keys(f.batches.at(-1)[0].nodesEffect), ['customParameterValues']);
	assert.equal(f.replica.nodesEffects[0].definition.customParameterValues[parameterId].value, 2);
	f.manager.commit('setNodesEffectNodeResolution', { target: nodeTarget({ ...f.target }), resolution: { mode: 'context', scale: 0.5 } });
	f.manager.commit('setNodesEffectCustomParameterSource', { target: customParameterTarget({ nodesEffectId: 'nodesEffect', parameterId }), source: { inputSource: 'literal', value: 3 } });
	await f.sync.flush();
	assert.ok(f.batches.at(-1).some(change => change.type === 'node' && change.changes.some(edit => edit.type === 'resolution')));
	assert.equal(f.replica.nodesEffects[0].definition.nodes[0].resolution.scale, 0.5);
	f.manager.commit('replaceNodesEffectCustomParameterDefinition', { target: { nodesEffect: { nodesEffectId: 'nodesEffect' }, parameterId }, definition: { ...definition, nameForReference: 'renamed' } });
	f.manager.commit('setNodesEffectCustomParameterSource', { target: customParameterTarget({ nodesEffectId: 'nodesEffect', parameterId }), source: { inputSource: 'literal', value: 4 } });
	await f.sync.flush();
	assert.notEqual(f.batches.at(-1)[0].customParameterValuesOnly, true);
	assert.equal(f.replica.nodesEffects[0].definition.customParameterDefs[parameterId].nameForReference, 'renamed');
	const target = customParameterTarget({ nodesEffectId: 'nodesEffect', parameterId });
	f.manager.commit('setNodesEffectCustomParameterSource', { target, source: { inputSource: 'expression', expression: 'TIME' } });
	await f.sync.flush();
	assert.notEqual(f.batches.at(-1)[0].customParameterValuesOnly, true);
	f.manager.commit('setNodesEffectCustomParameterSource', { target, source: { inputSource: 'expression', expression: 'TIME + 2' } });
	await f.sync.flush();
	assert.equal(f.batches.at(-1)[0].customParameterValuesOnly, true);
	assert.equal(f.replica.nodesEffects[0].definition.customParameterValues[parameterId].expression, 'TIME + 2');
	f.manager.commit('setNodesEffectNodeParameterSource', { ...nodeParameterTarget({ ...f.target }), source: { inputSource: 'nodesEffectCustomParameterValueReference', parameterId } });
	await f.sync.flush();
	const decoded = decodeProjectFile(await encodeProjectFile({ assets: [], generatedSpeech: [], curveAnimations: [],
		nodesEffects: f.manager.state.nodesEffects.value, timelineScenes: f.manager.state.timelineScenes.value }));
	assert.deepEqual(decoded.nodesEffects[0].definition.customParameterDefs, f.replica.nodesEffects[0].definition.customParameterDefs);
	assert.deepEqual(decoded.nodesEffects[0].definition.customParameterValues, f.replica.nodesEffects[0].definition.customParameterValues);
	assert.equal(decoded.nodesEffects[0].definition.nodes[0].params.buzzs.value[0].binding.value.x.inputSource, 'nodesEffectCustomParameterValueReference');
	assert.deepEqual(f.errors, []);
});

// 【ソロ変更と全解除をWorkerの複製状態へ反映し、Undo/Redoでも表示設定を保持する】
// コマンドだけが正しく動いても、全解除後に通知が空になったり通信で設定が落ちると
// プレビューと保存状態が食い違うため、実際の差分生成・複製・適用を通して確認する。
test('synchronizes solo toggles and clearing through undo and redo', async t => {
	const f = fixture(t);
	f.manager.state.assets.value = [{ id: 'asset', name: 'Image', fileDataType: 'image/png', fileData: new Blob([], { type: 'image/png' }) }];
	const child = createImageLayer('asset', 0);
	child.isDisabled = true;
	f.manager.commit('insertImportedAssets', { assets: [], timeline: { sceneId: 'scene', layers: [child] } });
	await f.sync.flush();
	assert.equal(f.replica.timelineScenes[0].layers[0].isSolo, false);
	f.manager.commit('setTimelineLayerSolo', { sceneId: 'scene', layerId: child.id, isSolo: true });
	await f.sync.flush();
	assert.equal(f.replica.timelineScenes[0].layers[0].isSolo, true);
	assert.deepEqual(f.batches.at(-1)[0].changes, [{ type: 'solo' }]);
	f.manager.undo();
	await f.sync.flush();
	assert.equal(f.replica.timelineScenes[0].layers[0].isSolo, false);
	f.manager.redo();
	await f.sync.flush();
	assert.equal(f.replica.timelineScenes[0].layers[0].isSolo, true);
	f.manager.commit('clearTimelineSolo', { sceneId: 'scene' });
	await f.sync.flush();
	assert.equal(f.replica.timelineScenes[0].layers[0].isSolo, false);
	f.manager.undo();
	await f.sync.flush();
	assert.equal(f.replica.timelineScenes[0].layers[0].isSolo, true);
	assert.equal(f.replica.timelineScenes[0].layers[0].isDisabled, true);
	assert.deepEqual(f.errors, []);
});

// 【ブラー無効化をレイヤー差分として同期し、Undo・Redoでも子の保存値を変更しない】
// グループの配下への適用は描画時の規則であり、子のbooleanを書き換えるとグループ解除や
// 別配置で元の設定へ戻れない。音声レイヤーには映像専用の設定を持ち込まない。
test('synchronizes motion blur overrides through undo and redo without mutating descendants', async t => {
	const f = fixture(t);
	f.manager.state.assets.value = [{ id: 'asset', name: 'Image', fileDataType: 'image/png', fileData: new Blob([], { type: 'image/png' }) }];
	const child = createImageLayer('asset', 0);
	assert.equal(child.forceDisableMotionBlur, false);
	const group = { id: 'group', name: 'Group', layerType: 'group', layers: [child], isDisabled: false,
		forceDisableMotionBlur: false, curveAnimations: [], compositingParamValues: {}, audioParamValues: { volume: { inputSource: 'literal', value: 1 } } };
	f.manager.commit('insertImportedAssets', { assets: [], timeline: { sceneId: 'scene', layers: [child] } });
	group.id = f.manager.commit('wrapTimelineLayers', { sceneId: 'scene', layerIds: [child.id], containerType: 'group', name: group.name }).layerId;
	await f.sync.flush();
	for (const layerId of [child.id, group.id]) {
		f.manager.commit('setTimelineLayerMotionBlurDisabled', { sceneId: 'scene', layerId, forceDisableMotionBlur: true });
		await f.sync.flush();
		assert.deepEqual(f.batches.at(-1)[0].changes, [{ type: 'motionBlur' }]);
		assert.equal(f.batches.at(-1)[0].layer.forceDisableMotionBlur, true);
		f.manager.undo();
		await f.sync.flush();
		assert.equal(f.batches.at(-1)[0].layer.forceDisableMotionBlur, false);
		f.manager.redo();
		await f.sync.flush();
		assert.equal(f.batches.at(-1)[0].layer.forceDisableMotionBlur, true);
		f.manager.undo();
		await f.sync.flush();
	}
	assert.equal(f.manager.state.timelineScenes.value[0].layers[0].layers[0].forceDisableMotionBlur, false);
	f.manager.state.timelineScenes.value[0].layers.push({ id: 'audio', layerType: 'audio' });
	assert.throws(() => f.manager.commit('setTimelineLayerMotionBlurDisabled', { sceneId: 'scene', layerId: 'audio', forceDisableMotionBlur: true }), /visual layer/);
	assert.deepEqual(f.errors, []);
});

// 【プロジェクトのノード数を増やしても、通常編集の送信量は変更ノード一つ分に収まる】
// deep watchで全Moduleを複製する経路が復活しないことを、実際の送信データで確認する。
// 配列内の末端値も、履歴のマージ・Undo・Redoを含めて確定値と編集内容の通知が一致する必要がある。
test('sends one node regardless of Nodes Effect size and synchronizes merged edits undo and redo', async t => {
	const sizes = [];
	for (const count of [1, 1000]) {
		const f = fixture(t, count);
		f.manager.commit('setNodesEffectNodeParameterSource', { ...nodeParameterTarget({ ...f.target }), source: { inputSource: 'literal', value: 0.25 } }, 'drag');
		f.manager.commit('setNodesEffectNodeParameterSource', { ...nodeParameterTarget({ ...f.target }), source: { inputSource: 'literal', value: 0.75 } }, 'drag');
		await f.sync.flush();
		assert.equal(f.batches.length, 1);
		assert.equal(f.batches[0].length, 1);
		assert.equal(f.batches[0][0].type, 'node');
		assert.deepEqual(f.batches[0][0].changes, [{ type: 'parameter', kind: 'value' }]);
		assert.equal(f.batches[0][0].nodesEffectId, 'nodesEffect');
		assert.equal(f.value(), 0.75);
		sizes.push(JSON.stringify(f.batches[0]).length);
		f.manager.undo();
		await f.sync.flush();
		assert.equal(f.value(), 0);
		f.manager.redo();
		await f.sync.flush();
		assert.equal(f.value(), 0.75);
		for (const batch of f.batches) assert.deepEqual(batch[0].changes, [{ type: 'parameter', kind: 'value' }]);
		assert.deepEqual(f.errors, []);
	}
	assert.equal(sizes[0], sizes[1]);
});

// 【レイヤー生成関数は表示状態で作成し、コピー元に依存しない】
// 必須のisDisabledが未設定だとUIと保存データの状態が曖昧になるため、新規作成時にfalseを保存する。
test('creates image effect and inline Nodes Effect layers enabled by default', () => {
	for (const layer of [createImageLayer('asset', 100), createEffectTimelineLayer({ ...definition, effectSource: { type: 'nativeEffect', id: 'testStructArray' } }, 100), createInlineNodesEffectLayer(100)]) {
		assert.equal(layer.isDisabled, false);
		if (layer.layerType === 'inlineNodesEffect') {
			assert.deepEqual(layer.nodesEffect.definition.customParameterDefs, []);
			assert.deepEqual(layer.nodesEffect.definition.customParameterValues, {});
		}
	}
});

// 【全種類のレイヤーの表示切り替えを対象だけへ同期し、Undo/Redoでも同じ変更を通知する】
// 状態を直接書き換えると履歴やWorker側の表示が追従しない。別Sceneに同じレイヤーIDがあっても
// 影響せず、クリップ・引数・キーは表示切り替えの前後で保持する必要がある。
test('synchronizes visibility for every layer type through undo and redo with scene-local targeting', async t => {
	const f = fixture(t);
	const base = { id: 'layer', name: 'Layer', isDisabled: false, clips: [], curveAnimations: [] };
	const compositing = { compositingParamValues: {} };
	const audio = { audioParamValues: { volume: { inputSource: 'literal', value: 1 } } };
	const layers = [
		{ ...base, ...compositing, layerType: 'image' },
		{ ...base, ...compositing, ...audio, layerType: 'video' },
		{ ...base, ...audio, layerType: 'audio' },
		{ ...base, ...compositing, ...audio, layerType: 'scene' },
		{ ...base, ...compositing, layerType: 'effect', effectSource: { type: 'nodesEffectReference', id: 'nodesEffect' }, effectParamValues: {} },
		{ ...createInlineNodesEffectLayer(100), id: base.id },
		{ ...createEffectTimelineLayer({ ...definition, effectSource: { type: 'nativeEffect', id: 'testStructArray' } }, 100), id: base.id },
	];
	const { sceneId: otherSceneId } = f.manager.commit('createTimelineScene', { name: 'Other' });
	f.manager.commit('insertImportedAssets', { assets: [], timeline: { sceneId: otherSceneId, layers: [layers[0]] } });
	await f.sync.flush();
	for (const original of layers) {
		f.manager.state.timelineScenes.value[0].layers = [structuredClone(original)];
		const target = { sceneId: 'scene', layerId: 'layer' };
		for (const isDisabled of [true, false]) {
			f.manager.commit('setTimelineLayerDisabled', { ...target, isDisabled });
			await f.sync.flush();
			assert.equal(f.batches.at(-1).length, 1);
			assert.deepEqual(f.batches.at(-1)[0], { type: 'layer', ...target, changes: [{ type: 'disabled' }], layer: { ...original, isDisabled } });
			assert.deepEqual(f.replica.timelineScenes[0].layers[0], { ...original, isDisabled });
			f.manager.undo();
			await f.sync.flush();
			assert.deepEqual(f.replica.timelineScenes[0].layers[0], { ...original, isDisabled: !isDisabled });
			f.manager.redo();
			await f.sync.flush();
			assert.deepEqual(f.replica.timelineScenes[0].layers[0], { ...original, isDisabled });
			assert.equal(f.replica.timelineScenes[1].layers[0].isDisabled, false);
		}
	}
	assert.deepEqual(f.errors, []);
});

// 【構造変更は後続の値編集に上書きされず、Module置換は古いノード差分を吸収する】
// 同じターンで配列追加→値編集、ノード編集→削除を行っても、途中の編集内容を失ったり
// 削除済みIDへの更新を送ったりしない。Undoでも最終的なCurve Animationを一度で反映する。
test('coalesces structural changes without replaying obsolete node updates', async t => {
	const f = fixture(t);
	f.manager.commit('insertNodesEffectNodeParameterArrayElement', { ...nodeParameterTarget({ ...f.target, paramPath: ['buzzs'] }) });
	f.manager.commit('setNodesEffectNodeParameterSource', { ...nodeParameterTarget({ ...f.target }), source: { inputSource: 'literal', value: 0.5 } });
	await f.sync.flush();
	assert.deepEqual(f.batches[0][0].changes, [{ type: 'parameter', kind: 'arrayElements' }, { type: 'parameter', kind: 'value' }]);
	assert.equal(f.replica.nodesEffects[0].definition.nodes[0].params.buzzs.value.length, 2);
	f.manager.commit('setNodesEffectNodeParameterSource', { ...nodeParameterTarget({ ...f.target }), source: { inputSource: 'literal', value: 0.9 } });
	f.manager.commit('removeNodesEffectNode', { target: { nodesEffect: { nodesEffectId: 'nodesEffect' }, nodeId: 'node-0' } });
	await f.sync.flush();
	assert.deepEqual(f.batches.at(-1).map(change => change.type), ['nodesEffect']);
	assert.equal(f.replica.nodesEffects[0].definition.nodes.length, 0);
	f.manager.undo();
	await f.sync.flush();
	assert.equal(f.value(), 0.9);
	assert.deepEqual(f.errors, []);
});

// 【追加直後のScene・レイヤーの編集は親の最新スナップショットに取り込む】
// まだ受信側に存在しない子IDへ先に差分を送ったり、削除済みレイヤーの並びを送ったりしない。
test('absorbs child edits into newly added scenes and layers', async t => {
	const f = fixture(t);
	const inline = { id: 'inline', name: 'Inline', resolution: { mode: 'auto', scale: 1 }, layerType: 'effect', effectSource: { type: 'inlineNodesEffect', nodesEffect: structuredClone(f.replica.nodesEffects[0].definition) }, clips: [], effectParamValues: {}, compositingParamValues: {}, curveAnimations: [] };
	f.manager.commit('insertImportedAssets', { assets: [], timeline: { sceneId: 'scene', layers: [inline] } });
	f.manager.commit('setNodesEffectNodeParameterSource', { ...nodeParameterTarget({ sceneId: 'scene', layerId: 'inline', nodeId: 'node-0', paramPath: f.target.paramPath }), source: { inputSource: 'literal', value: 0.3 } });
	await f.sync.flush();
	assert.deepEqual(f.batches.at(-1).map(change => change.type), ['layer', 'layerOrder']);
	assert.equal(f.replica.timelineScenes[0].layers[0].effectSource.nodesEffect.nodes[0].params.buzzs.value[0].binding.value.x.value, 0.3);
	const { sceneId: childSceneId } = f.manager.commit('createTimelineScene', { name: 'Child' });
	f.manager.commit('insertImportedAssets', { assets: [], timeline: { sceneId: childSceneId, layers: [inline] } });
	await f.sync.flush();
	assert.deepEqual(f.batches.at(-1).map(change => change.type), ['scene']);
	assert.equal(f.replica.timelineScenes[1].layers.length, 1);
	f.manager.commit('removeTimelineLayers', { sceneId: childSceneId, layerIds: ['inline'] });
	f.manager.commit('removeTimelineScene', { sceneId: childSceneId });
	await f.sync.flush();
	assert.equal(f.replica.timelineScenes.length, 1);
	assert.deepEqual(f.errors, []);
});

const group = (id, layers = []) => ({ id, name: id, layerType: 'group', layers, isDisabled: false, curveAnimations: [],
	compositingParamValues: {}, audioParamValues: { volume: { inputSource: 'literal', value: 1 } } });

// 【階層変更と同時の子の編集を保持し、削除された子への差分は送らない】
// Scene全体の置換に吸収すると、無関係の履歴まで破棄するか、保持すべきでない履歴を残してしまう。
// グループのUndoで復活するインライン定義にも編集済みの値が含まれる必要がある。
test('retains inline edit metadata across reparenting and restores edited deleted groups on undo', async t => {
	const f = fixture(t);
	const inline = { ...createInlineNodesEffectLayer(0), id: 'inline', effectSource: { type: 'inlineNodesEffect', nodesEffect: structuredClone(f.replica.nodesEffects[0].definition) } };
	f.manager.commit('insertImportedAssets', { assets: [], timeline: { sceneId: 'scene', layers: [group('group', [inline])] } });
	await f.sync.flush();
	const edit = value => f.manager.commit('setNodesEffectNodeParameterSource', { ...nodeParameterTarget({ sceneId: 'scene', layerId: 'inline', nodeId: 'node-0', paramPath: f.target.paramPath }), source: { inputSource: 'literal', value: value } });
	edit(0.4);
	f.manager.commit('moveTimelineLayerInTree', { sceneId: 'scene', layerId: 'inline', parentId: null, beforeId: null });
	await f.sync.flush();
	assert.deepEqual(f.batches.at(-1).map(change => change.type), ['layerTree', 'node']);
	const changedNode = f.batches.at(-1)[1];
	assert.equal(changedNode.sceneId, 'scene');
	assert.equal(changedNode.layerId, 'inline');
	assert.deepEqual(changedNode.changes, [{ type: 'parameter', kind: 'value' }]);
	assert.equal(f.replica.timelineScenes[0].layers[1].effectSource.nodesEffect.nodes[0].params.buzzs.value[0].binding.value.x.value, 0.4);
	f.manager.undo();
	await f.sync.flush();
	edit(0.8);
	f.manager.commit('removeTimelineLayers', { sceneId: 'scene', layerIds: ['group'] });
	await f.sync.flush();
	assert.deepEqual(f.batches.at(-1).map(change => change.type), ['layerTree']);
	assert.deepEqual(f.replica.timelineScenes[0].layers, []);
	f.manager.undo();
	await f.sync.flush();
	assert.equal(f.replica.timelineScenes[0].layers[0].layers[0].effectSource.nodesEffect.nodes[0].params.buzzs.value[0].binding.value.x.value, 0.8);
	assert.deepEqual(f.errors, []);
});

// 【入れ子のグループ移動は各レイヤーの設定を一度だけ送る】
// 親ごとに全子孫を複製すると深さに応じて送信量が二乗で増え、ドラッグのたびに遅延する。
// Undo/Redoでも子の配置を失わず、クリップ移動などの変更種別を個別に保持する。
test('sends each layer once without nested snapshots when moving a deep group', async t => {
	const f = fixture(t);
	let root = { ...createEffectTimelineLayer({ ...definition, effectSource: { type: 'nativeEffect', id: 'testStructArray' } }, 1000), id: 'effect' };
	for (let index = 0; index < 8; index++) root = group('group-' + index, [root]);
	f.manager.commit('insertImportedAssets', { assets: [], timeline: { sceneId: 'scene', layers: [root] } });
	await f.sync.flush();
	const before = structuredClone(f.replica);
	f.manager.commit('moveTimelineContainerInTime', { sceneId: 'scene', layerId: root.id, deltaMs: 100 });
	await f.sync.flush();
	const after = structuredClone(f.replica);
	const assertBatch = () => {
		const batch = f.batches.at(-1);
		assert.equal(batch.length, 9);
		assert.equal(new Set(batch.map(change => change.layerId)).size, 9);
		for (const change of batch) {
			assert.equal(change.type, 'layer');
			assert.equal('layers' in change.layer, false);
			if (change.layer.layerType === 'group') assert.ok(change.changes.every(edit => edit.type === 'parameter'));
			else assert.ok(change.changes.some(edit => edit.type === 'clips'));
		}
	};
	assertBatch();
	f.manager.undo();
	await f.sync.flush();
	assertBatch();
	assert.deepEqual(f.replica, before);
	f.manager.redo();
	await f.sync.flush();
	assertBatch();
	assert.deepEqual(f.replica, after);
	assert.deepEqual(f.errors, []);
});

// 【Module引数の履歴と、同時に編集したノード・合成設定の変更内容を通知する】
// 同じレイヤーだからと最後の編集種別だけ残すと、合成設定やリセットが通常の値編集に
// 化けてしまう。Inline Moduleの部分編集も吸収せず、レンダラーが判断する材料を保つ。
test('retains layer edit kinds through merged history and simultaneous inline edits', async t => {
	const f = fixture(t);
	const nodesEffect = structuredClone(f.replica.nodesEffects[0]);
	nodesEffect.definition.paramDefs = { amount: { nameForReference: 'amount', dataType: { kind: 'scalar' },
		ui: { label: 'Amount', control: { controlType: 'number' } }, canNode: false, defaultValue: 1 } };
	f.manager.commit('insertImportedAssets', { assets: [], timeline: { sceneId: 'scene', layers: [{ id: 'inline', name: 'Inline', resolution: { mode: 'auto', scale: 1 }, layerType: 'effect', effectSource: { type: 'inlineNodesEffect', nodesEffect: nodesEffect.definition }, clips: [], effectParamValues: {}, compositingParamValues: {}, curveAnimations: [] }] } });
	await f.sync.flush();
	const target = { sceneId: 'scene', layerId: 'inline', target: 'effect', paramPath: ['amount'] };
	const edit = value => f.manager.commit('setTimelineLayerParameterSource', { ...timelineParameterTarget({ ...target }), source: { inputSource: 'literal', value: value } }, 'arguments');
	edit(2);
	edit(3);
	await f.sync.flush();
	assert.deepEqual(f.batches.at(-1)[0].changes, [{ type: 'parameter', target: 'effect', kind: 'value' }]);
	assert.equal(f.replica.timelineScenes[0].layers[0].effectParamValues.amount.value, 3);
	f.manager.undo();
	await f.sync.flush();
	assert.deepEqual(f.replica.timelineScenes[0].layers[0].effectParamValues, {});
	f.manager.redo();
	await f.sync.flush();
	assert.equal(f.replica.timelineScenes[0].layers[0].effectParamValues.amount.value, 3);
	assert.deepEqual(f.batches.at(-1)[0].changes, [{ type: 'parameter', target: 'effect', kind: 'value' }]);

	f.manager.commit('resetTimelineLayerParameter', { ...timelineParameterTarget({ ...target, edit: { kind: 'reset' } }) });
	edit(4);
	f.manager.commit('setTimelineLayerParameterSource', { ...timelineParameterTarget({ ...target, target: 'compositing', paramPath: ['opacity'] }), source: { inputSource: 'literal', value: 0.5 } });
	f.manager.commit('setNodesEffectNodeParameterSource', { ...nodeParameterTarget({ sceneId: 'scene', layerId: 'inline', nodeId: 'node-0', paramPath: f.target.paramPath }), source: { inputSource: 'literal', value: 0.75 } });
	await f.sync.flush();
	const batch = f.batches.at(-1);
	assert.deepEqual(batch.map(change => change.type), ['node', 'layer']);
	assert.deepEqual(batch[0].changes, [{ type: 'parameter', kind: 'value' }]);
	assert.deepEqual(batch[1].changes, [
		{ type: 'parameter', target: 'effect', kind: 'reset' }, { type: 'parameter', target: 'effect', kind: 'value' },
		{ type: 'parameter', target: 'compositing', kind: 'value' },
	]);
	const replica = f.replica.timelineScenes[0].layers[0];
	assert.equal(replica.effectSource.nodesEffect.nodes[0].params.buzzs.value[0].binding.value.x.value, 0.75);
	assert.equal(replica.effectParamValues.amount.value, 4);
	assert.equal(replica.compositingParamValues.opacity.value, 0.5);
	assert.deepEqual(f.errors, []);
});

// 【状態管理は表示名や解像度の編集も通知し、描画同期側が対象を選ぶ】
// Commandが描画の都合で通知を省略すると、状態管理が購読先に依存してしまう。
// 専用の同期経路がある変更を、この差分経路から重複送信しないことも確認する。
test('publishes state changes independently of renderer subscriptions', async t => {
	const f = fixture(t);
	const notifications = [];
	const unsubscribe = f.manager.onChange(changes => notifications.push(changes));
	f.manager.commit('setTimelineSceneName', { sceneId: 'scene', name: 'Renamed' });
	f.manager.commit('setProjectResolution', { resolution: { width: 320, height: 180 } });
	f.manager.undo();
	await f.sync.flush();
	assert.deepEqual(notifications, [[{ type: 'sceneName', sceneId: 'scene' }], [{ type: 'projectResolution' }], [{ type: 'projectResolution' }]]);
	assert.deepEqual(f.batches, []);
	unsubscribe();
	f.manager.redo();
	assert.equal(notifications.length, 3);
});

// 【Nodes Effectの名前変更は履歴に残し、ノードや描画インスタンスへ影響させない】
// 表示名の変更を登録変更として送ると、名前を入力するだけでEffect Live Previewや履歴を持つエフェクトが再初期化される。
// 登録済みはNodes Effect自身、インラインはレイヤーの名前を変更し、Undo/Redoでも同じIDと構成を維持する。
test('renames registered and inline Nodes Effects through history without renderer patches', async t => {
	const f = fixture(t);
	const registeredNodesEffect = f.manager.state.nodesEffects.value[0];
	const originalName = registeredNodesEffect.name;
	const originalNodes = registeredNodesEffect.definition.nodes;
	const inlineLayer = createInlineNodesEffectLayer(0);
	const originalLayerName = inlineLayer.name;
	f.manager.state.timelineScenes.value[0].layers.push(inlineLayer);
	const notifications = [];
	f.manager.onChange(changes => notifications.push(changes));
	f.manager.commit('setNodesEffectName', { target: { nodesEffectId: registeredNodesEffect.id }, name: 'Renamed Nodes Effect' });
	f.manager.commit('setTimelineLayerName', { sceneId: 'scene', layerId: inlineLayer.id, name: 'Renamed Inline Nodes Effect' });
	await f.sync.flush();
	assert.equal(registeredNodesEffect.name, 'Renamed Nodes Effect');
	assert.equal(f.manager.state.timelineScenes.value[0].layers[0].name, 'Renamed Inline Nodes Effect');
	assert.equal(f.manager.undoStack.value.length, 2);
	f.manager.undo();
	f.manager.undo();
	assert.equal(registeredNodesEffect.name, originalName);
	assert.equal(f.manager.state.timelineScenes.value[0].layers[0].name, originalLayerName);
	f.manager.redo();
	f.manager.redo();
	await f.sync.flush();
	assert.equal(registeredNodesEffect.name, 'Renamed Nodes Effect');
	assert.equal(f.manager.state.timelineScenes.value[0].layers[0].name, 'Renamed Inline Nodes Effect');
	assert.equal(registeredNodesEffect.id, 'nodesEffect');
	assert.equal(registeredNodesEffect.definition.nodes, originalNodes);
	assert.equal(f.manager.state.timelineScenes.value[0].layers[0].id, inlineLayer.id);
	assert.equal(f.manager.state.timelineScenes.value[0].layers[0].effectSource.nodesEffect.name, undefined);
	const registeredNameChange = [{ type: 'nodesEffectName', nodesEffectId: 'nodesEffect' }];
	const inlineNameChange = [{ type: 'layerName', sceneId: 'scene', layerId: inlineLayer.id }];
	assert.deepEqual(notifications, [registeredNameChange, inlineNameChange, inlineNameChange, registeredNameChange, registeredNameChange, inlineNameChange]);
	assert.deepEqual(f.batches, []);
	assert.deepEqual(f.errors, []);
});

// 【差分失敗は所有者へ通知し、全量再送や成功通知を行わない】
// 失敗後のエンジン破棄・再生成はPreviewRenderEngineが担当する。
// Synchronizerが独自に再同期すると、停止済みのレンダラーや解除済みの購読を復活させてしまう。
test('reports failed patches without resynchronizing and ignores failures after disposal', async t => {
	const gate = Promise.withResolvers();
	let updated = 0;
	const f = fixture(t, 1, { apply: () => gate.promise, onUpdated: () => { updated++; } });
	f.manager.commit('setNodesEffectNodeParameterSource', { ...nodeParameterTarget({ ...f.target }), source: { inputSource: 'literal', value: 0.5 } });
	const flushed = f.sync.flush();
	gate.reject(new Error('patch rejected'));
	await flushed;
	assert.equal(f.errors.length, 1);
	assert.equal(f.errors[0].message, 'patch rejected');
	assert.equal(f.value(), 0);
	assert.equal(updated, 0);
	const oldGate = Promise.withResolvers();
	const old = fixture(t, 1, { apply: () => oldGate.promise });
	old.manager.commit('setNodesEffectNodeParameterSource', { ...nodeParameterTarget({ ...old.target }), source: { inputSource: 'literal', value: 0.25 } });
	const oldFlushed = old.sync.flush();
	old.sync.dispose();
	oldGate.reject(new Error('old worker'));
	await oldFlushed;
	assert.deepEqual(old.errors, []);
});

// 【カメラの編集・Undo・Redoを通常のレイヤー差分として同期する】
// カメラだけの編集でScene全体を置換すると、他レイヤーの動画・履歴が再生成される。
// 既存の差分経路に統合し、映像レイヤーの参照を維持することを確認する。
test('synchronizes camera layer edits and undo without replacing other layers', async t => {
	const f = fixture(t);
	const camera = createCameraTimelineLayer(0);
	const image = createInlineNodesEffectLayer(0);
	f.manager.commit('insertImportedAssets', { assets: [], timeline: { sceneId: 'scene', layers: [image] } });
	f.manager.commit('insertImportedAssets', { assets: [], timeline: { sceneId: 'scene', layers: [camera] } });
	await f.sync.flush();
	const originalImage = f.replica.timelineScenes[0].layers.find(layer => layer.id === image.id);
	const target = { sceneId: 'scene', layerId: camera.id, target: 'camera' };
	f.manager.commit('setTimelineLayerParameterSource', { ...timelineParameterTarget({ ...target, paramPath: ['position'] }), source: { inputSource: 'literal', value: [0.4, 0.2] } });
	f.manager.commit('setTimelineLayerParameterSource', { ...timelineParameterTarget({ ...target, paramPath: ['z'] }), source: { inputSource: 'expression', expression: 'TIME + 3' } });
	await f.sync.flush();
	const values = () => f.replica.timelineScenes[0].layers.find(layer => layer.id === camera.id).cameraParamValues;
	assert.equal(f.batches.at(-1).length, 1);
	assert.equal(f.batches.at(-1)[0].type, 'layer');
	assert.equal(values().z.expression, 'TIME + 3');
	f.manager.undo(); await f.sync.flush();
	assert.deepEqual(values().z, camera.cameraParamValues.z);
	f.manager.undo(); await f.sync.flush();
	assert.deepEqual(values().position.value, [0, 0]);
	f.manager.redo(); f.manager.redo(); await f.sync.flush();
	assert.deepEqual(values().position.value, [0.4, 0.2]);
	assert.equal(f.replica.timelineScenes[0].layers.find(layer => layer.id === image.id), originalImage);
	assert.deepEqual(f.errors, []);
});

const { getAvailableCurveAnimations, getTimelineScenesWithProjectCurveAnimations, ParameterBindingEvaluator,
	TimelineAudioRenderer, getSceneAudioClips, createProjectCurveAnimation, encodeProjectFile, decodeProjectFile } = module.exports;
const sharedCurveAnimation = (id = 'shared', nameForReference = 'Curve', value = null) => ({ id, nameForReference, isNormalized: false,
	points: [0, 1000].map((x, index) => ({ id: id + index, x, y: value ?? index, bezierControlPointA: [0, 0], bezierControlPointB: [0, 0] })),
});
const curveAnimationReference = id => ({ inputSource: 'curveAnimationReference', curveAnimationId: id, trimmedDurationMs: null, wrapMode: 'clamp', offsetMode: 'start' });

// 【共通定義の編集・削除・Undo/Redoと同期・保存は、参照元のIDを維持する】
// 削除時にBindingをnullへ書き換えるとUndoで再接続できない。曲線変更も最新の定義を送り、
// 名前変更後のID参照と保存ファイル内の定義が食い違わないことを確認する。
test('synchronizes and saves shared Curve Animations through editing deletion undo and redo', async t => {
	const f = fixture(t);
	const input = sharedCurveAnimation();
	const { curveAnimationId } = f.manager.commit('createProjectCurveAnimation', { nameForReference: input.nameForReference, data: input });
	const curveAnimation = JSON.parse(JSON.stringify(f.manager.state.curveAnimations.value.find(candidate => candidate.id === curveAnimationId)));
	const layer = createImageLayer('asset', 0);
	layer.compositingParamValues.opacity = curveAnimationReference(curveAnimation.id);
	f.manager.state.timelineScenes.value[0].layers.push(layer);
	await f.sync.flush();
	assert.deepEqual(f.replica.curveAnimations, [curveAnimation]);
	const renamed = { ...curveAnimation, nameForReference: 'Renamed', points: curveAnimation.points.map(point => ({ ...point, y: 0.25 })) };
	f.manager.commit('replaceProjectCurveAnimation', { curveAnimationId: (renamed).id, definition: renamed });
	await f.sync.flush();
	assert.deepEqual(f.replica.curveAnimations, [renamed]);
	const decoded = decodeProjectFile(await encodeProjectFile({ curveAnimations: f.manager.state.curveAnimations.value,
		assets: [], generatedSpeech: [], nodesEffects: [], timelineScenes: f.manager.state.timelineScenes.value }));
	assert.deepEqual(decoded.curveAnimations, [renamed]);
	assert.equal(decoded.timelineScenes[0].layers[0].compositingParamValues.opacity.curveAnimationId, curveAnimation.id);
	f.manager.commit('removeProjectCurveAnimation', { curveAnimationId: curveAnimation.id });
	await f.sync.flush();
	assert.deepEqual(f.replica.curveAnimations, []);
	assert.equal(f.manager.state.timelineScenes.value[0].layers[0].compositingParamValues.opacity.curveAnimationId, curveAnimation.id);
	f.manager.undo();
	await f.sync.flush();
	assert.deepEqual(f.replica.curveAnimations, [renamed]);
	f.manager.redo();
	await f.sync.flush();
	assert.deepEqual(f.replica.curveAnimations, []);
});

// 【共通定義の参照名はプロジェクト内で一意にし、複製では曲線とIDを独立させる】
// CURVE_ANIMATION()の解決を登録順に依存させず、失敗したコマンドで一覧の一部だけが変更されないようにする。
test('validates shared Curve Animation names and creates copies with independent data and IDs', t => {
	const f = fixture(t);
	const input = sharedCurveAnimation();
	const { curveAnimationId } = f.manager.commit('createProjectCurveAnimation', { nameForReference: input.nameForReference, data: input });
	const curveAnimation = JSON.parse(JSON.stringify(f.manager.state.curveAnimations.value.find(candidate => candidate.id === curveAnimationId)));
	for (const invalid of [{ ...curveAnimation, id: 'other' }, { ...curveAnimation, id: 'empty', nameForReference: '  ' }]) {
		assert.throws(() => f.manager.commit('createProjectCurveAnimation', { nameForReference: invalid.nameForReference, data: invalid }));
	}
	const { curveAnimationId: copyId } = f.manager.commit('duplicateProjectCurveAnimation', { curveAnimationId: curveAnimation.id });
	const copy = JSON.parse(JSON.stringify(f.manager.state.curveAnimations.value.find(curveAnimation => curveAnimation.id === copyId)));
	assert.notEqual(copy.id, curveAnimation.id);
	assert.notEqual(copy.nameForReference, curveAnimation.nameForReference);
	assert.notEqual(copy.points[0].id, curveAnimation.points[0].id);
	copy.points[0].y = 100;
	assert.equal(curveAnimation.points[0].y, 0);
	f.manager.commit('replaceProjectCurveAnimation', { curveAnimationId: copy.id, definition: copy });
	assert.throws(() => f.manager.commit('replaceProjectCurveAnimation', { curveAnimationId: ({ ...copy, nameForReference: curveAnimation.nameForReference }).id, definition: { ...copy, nameForReference: curveAnimation.nameForReference } }));
	assert.equal(f.manager.state.curveAnimations.value[1].nameForReference, copy.nameForReference);
});

// 【名前参照はローカル優先でも、ID参照は同名の共通定義を選べる】
// 名前の上書きで共通定義自体を候補から除くと、選択済みのID参照まで失われてしまう。
// 曲線の保存場所に時計を持たせず、参照元の時刻が評価値を決めることも確認する。
test('prefers local names while resolving shared IDs using the caller clock', () => {
	const definition = { dataType: { kind: 'scalar' }, ui: { label: 'Value' } };
	const evaluator = new ParameterBindingEvaluator(new ExpressionEvaluator());
	const global = sharedCurveAnimation();
	const local = sharedCurveAnimation('local', global.nameForReference, 0.75);
	const scope = { curveAnimations: getAvailableCurveAnimations([local], [global]), time: 200, endTime: Infinity, variables: {} };
	assert.equal(evaluator.evaluate({ inputSource: 'expression', expression: 'CURVE_ANIMATION("Curve", 200, "clamp")' }, scope, -1, definition), 0.75);
	assert.equal(evaluator.evaluate(curveAnimationReference(local.id), scope, -1, definition), 0.75);
	assert.ok(Math.abs(evaluator.evaluate(curveAnimationReference(global.id), scope, -1, definition) - 0.2) < 1e-8);
	assert.ok(Math.abs(evaluator.evaluate(curveAnimationReference(global.id), { ...scope, time: 800 }, -1, definition) - 0.8) < 1e-8);
	assert.equal(evaluator.evaluate(curveAnimationReference('deleted'), scope, 0.4, definition), 0.4);
});

// 【グループ内でも参照元レイヤーだけのローカル定義を使い、Nodes Effect内部へ公開しない】
// 評価用のSceneを組み立てる際に保存状態を変更すると、共有定義がレイヤーやNodes Effectへ
// コピーされ、編集の二重管理や持ち出し時の意図しない依存が生じる。
test('composes timeline evaluation Curve Animations without mutating saved layers or Nodes Effect internals', () => {
	const global = sharedCurveAnimation();
	const child = { id: 'child', layerType: 'effect', effectSource: { type: 'inlineNodesEffect', nodesEffect: { curveAnimations: [] } }, curveAnimations: [] };
	const group = { id: 'group', layerType: 'group', curveAnimations: [sharedCurveAnimation('parent')], layers: [child] };
	const scenes = [{ id: 'scene', layers: [group] }];
	const [evaluated] = getTimelineScenesWithProjectCurveAnimations(scenes, [global]);
	assert.deepEqual(evaluated.layers[0].curveAnimations.map(curveAnimation => curveAnimation.id), ['parent', 'shared']);
	assert.deepEqual(evaluated.layers[0].layers[0].curveAnimations.map(curveAnimation => curveAnimation.id), ['shared']);
	assert.equal(evaluated.layers[0].layers[0].effectSource.nodesEffect, child.effectSource.nodesEffect);
	assert.deepEqual(child.effectSource.nodesEffect.curveAnimations, []);
	assert.deepEqual(child.curveAnimations, []);
	assert.deepEqual(group.curveAnimations.map(curveAnimation => curveAnimation.id), ['parent']);
});

// 【音量も映像と同じ候補を使い、子Sceneの配置ではそのSceneの時計で評価する】
// 最上位の時刻だけで共通Curve Animationを一度評価すると、子Sceneのトリムや配置位置で音量がずれる。
// 実際の音声計画とミキサーを通して、プレビュー・書き出し両方のPCMを確認する。
test('evaluates shared audio gain in nested scene time during preview and export', async () => {
	const curveAnimation = sharedCurveAnimation();
	const audioLayer = { id: 'audio', layerType: 'audio', isDisabled: false, curveAnimations: [],
		audioParamValues: { volume: curveAnimationReference(curveAnimation.id) }, clips: [{ id: 'audio-clip', assetId: 'sound',
			startMs: 0, sourceInMs: 0, sourceOutMs: 1000, playbackRate: 1, loop: false, durationMs: 1000 }] };
	const sceneLayer = { id: 'nested', layerType: 'scene', isDisabled: false, curveAnimations: [], audioParamValues: { volume: { inputSource: 'literal', value: 1 } },
		clips: [{ id: 'nested-clip', sceneId: 'child', startMs: 1000, contentOffsetMs: 200, durationMs: 500 }] };
	const scenes = getTimelineScenesWithProjectCurveAnimations([{ id: 'root', layers: [sceneLayer] }, { id: 'child', layers: [audioLayer] }], [curveAnimation]);
	const clips = getSceneAudioClips(scenes, 'root');
	assert.equal(clips.length, 1);
	const renderer = new TimelineAudioRenderer(async (_source, _time, frames) => [new Float32Array(frames).fill(1), new Float32Array(frames).fill(1)]);
	for (const isExport of [false, true]) {
		const pcm = await renderer.renderClips(clips, 1000, 1, 1000, isExport);
		assert.ok(Math.abs(pcm[0][0] - 0.2) < 1e-6);
	}
});
