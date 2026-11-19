import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyRendererProjectChanges, findRendererCustomNodeGraphEffect } from '../src/project/renderer-state.ts';
import { customNodeGraphEffectTargetKey } from '../src/project/custom-node-graph-effect-target.ts';

const registeredTarget = { customNodeGraphEffectId: 'graph' };
const layerTarget = { sceneId: 'scene', layerId: 'layer' };
const graph = { kind: 'generate', paramDefs: {}, outputDefs: {}, primaryInputParameter: null, primaryOutput: null,
	resolutionInputParameters: [], nodes: [], outputSources: {} };
const shader = { ...graph, outputDefs: { color: { dataType: { kind: 'color' }, nameForReference: 'color' } },
	primaryOutput: 'color', shaderApiVersion: 1, code: '' };
const node = { id: 'node', effectSource: { type: 'nativeEffect', id: 'image' }, params: {} };
const state = {
	automationGraphs: [],
	customNodeGraphEffects: [{ id: 'graph', name: 'Main', nodeMetadata: { node: { displayName: 'Input' } }, definition: { ...graph, nodes: [node] } }],
	customShaderEffects: [],
	timelineScenes: [{ id: 'scene', layers: [{ id: 'folder', layerType: 'folder', layers: [
		{ id: 'layer', layerType: 'effect', effectSource: { type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: graph } },
	] }] }],
};

// 【登録の編集と、それを使うノードの変更を一度の差分で反映する】
// 描画側が旧状態を保持していても、変更したノード・ポートに新旧の定義が混在せず、編集情報も引き継がれる。
test('applies registration and placement changes in one immutable batch', () => {
	const registration = { id: 'graph', name: 'Shader', summary: '', definition: shader };
	const replacement = { ...node, effectSource: { type: 'customShaderEffectReference', id: 'graph' } };
	const changes = [
		{ type: 'customShaderEffectRegistration', customShaderEffectId: 'graph', customShaderEffect: registration },
		{ type: 'node', customNodeGraphEffectId: 'graph', node: replacement, changes: [{ type: 'effectSource' }] },
	];
	const next = applyRendererProjectChanges(state, changes);
	assert.equal(findRendererCustomNodeGraphEffect(next, registeredTarget).nodes[0], replacement);
	assert.equal(findRendererCustomNodeGraphEffect(state, registeredTarget).nodes[0], node);
	assert.equal(next.customNodeGraphEffects[0].nodeMetadata, state.customNodeGraphEffects[0].nodeMetadata);
	assert.equal(next.customShaderEffects[0], registration);
	assert.deepEqual(state.customShaderEffects, []);
	assert.equal(next.timelineScenes, state.timelineScenes);
	const updated = { ...registration, definition: { ...shader, code: 'updated' } };
	const edited = applyRendererProjectChanges(next, [{ ...changes[0], customShaderEffect: updated }]);
	assert.deepEqual(edited.customShaderEffects, [updated]);
	const removed = applyRendererProjectChanges(edited, [
		{ ...changes[0], customShaderEffect: null },
		{ type: 'customNodeGraphEffectRegistration', customNodeGraphEffectId: 'graph', customNodeGraphEffect: null },
	]);
	assert.deepEqual(removed.customShaderEffects, []);
	assert.deepEqual(removed.customNodeGraphEffects, []);
	assert.equal(next.customShaderEffects[0], registration);
});

// 【失敗した差分列で既存の登録を上書きしない】
// 後続の差分の対象が見つからなければ、Workerはバッチを破棄して元のスナップショットから再同期できる。
test('leaves the previous state intact when a later change in a batch fails', () => {
	const original = structuredClone(state);
	assert.throws(() => applyRendererProjectChanges(state, [
		{ type: 'customNodeGraphEffect', customNodeGraphEffectId: 'graph', customNodeGraphEffect: graph },
		{ type: 'node', customNodeGraphEffectId: 'graph', node, changes: [{ type: 'effectSource' }] },
	]), /Node not found/);
	assert.deepEqual(state, original);
});

// 【インラインの編集は所有するEffectレイヤーの差分で反映する】
// 同じSceneのフォルダ内も探索し、配置が登録参照に切り替わったら古いインライン定義を返さない。
test('locates inline graphs through nested effect layers and replaces their owner', () => {
	assert.equal(findRendererCustomNodeGraphEffect(state, layerTarget), graph);
	assert.notEqual(customNodeGraphEffectTargetKey(registeredTarget), customNodeGraphEffectTargetKey(layerTarget));
	const editLayer = effectSource => ({ type: 'layer', ...layerTarget, layer: { id: 'layer', layerType: 'effect', effectSource },
		changes: [{ type: 'definition' }] });
	const replacement = { ...graph, nodes: [node] };
	const next = applyRendererProjectChanges(state, [editLayer({ type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: replacement })]);
	assert.equal(findRendererCustomNodeGraphEffect(next, layerTarget), replacement);
	assert.equal(findRendererCustomNodeGraphEffect(state, layerTarget), graph);
	const referenced = applyRendererProjectChanges(next, [editLayer({ type: 'customNodeGraphEffectReference', id: 'graph' })]);
	assert.equal(findRendererCustomNodeGraphEffect(referenced, layerTarget), null);
	assert.equal(findRendererCustomNodeGraphEffect(referenced, registeredTarget), state.customNodeGraphEffects[0].definition);
});
