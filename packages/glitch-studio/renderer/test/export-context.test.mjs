import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { TimelineRenderer } from '@gs/subsystems_timeline_renderer/timeline-renderer.ts';
import { loadShaderSource } from './helpers/load-shader-source.mjs';
import { createCustomNodeGraphEffectRenderer } from './helpers/create-custom-node-graph-effect-renderer.mjs';
const { createCustomNodeGraphEffectTimelineLayer } = await loadShaderSource(fileURLToPath(import.meta.resolve('@gs/subsystems_timeline_renderer/layers/custom-node-graph-effect/custom-node-graph-effect-timeline-layer.ts')));

globalThis.GPUQueue = class { submit() {} };
const { CustomNodeGraphEffectRenderer } = await loadShaderSource(fileURLToPath(import.meta.resolve('@gs/subsystems_custom-node-graph-effect_renderer/custom-node-graph-effect-renderer.ts')));

// エクスポート指定をレイヤー変換まで伝え、後続の通常シークには残さない。
test('passes export context through timeline layers and resets it for preview', async () => {
	const contexts = [];
	const renderer = new TimelineRenderer({
		fallbackOutput: null,
		createLayer: () => createCustomNodeGraphEffectTimelineLayer({ customParameterDefs: [], customParameterValues: {}, paramDefs: [], primaryInputId: null }, { customNodeGraphEffectParamValues: {}, automationGraphs: [] }, {
			async prepare() {},
			async render(context) { contexts.push(context); return { gpuTime: 0 }; },
			destroy() {},
		}),
		present() {},
	});
	const timeline = [{ id: 'layer', name: 'Layer', clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 1000 }] }];
	await renderer.renderAt(0, timeline, 0, true);
	await renderer.renderAt(100, timeline, 100, true);
	await renderer.renderAt(200, timeline);
	assert.deepEqual(contexts.map(context => context.isExport), [true, true, false]);
	renderer.clear();
});

// 単独参照と複合式の両方で真偽値を評価し、繰り返し評価しても値が残らない。
test('evaluates IS_EXPORT in Custom Node Graph Effect and node expressions without leaking state', () => {
	const evaluator = createCustomNodeGraphEffectRenderer(CustomNodeGraphEffectRenderer).parameterEvaluator;
	const definition = { dataType: { kind: 'bool' }, ui: { label: 'Export' } };
	for (const isExport of [false, true, false, true, false]) {
		const scope = { variables: { IS_EXPORT: isExport }, automationGraphs: [], time: 0, endTime: 1000 };
		const value = evaluator.valueEvaluator.evaluate({ inputSource: 'expression', expression: 'IS_EXPORT' }, scope, false, definition);
		assert.equal(value, isExport);
		for (const expression of ['IS_EXPORT', 'IS_EXPORT == true', 'PUBLIC("export")']) {
			assert.equal(evaluator.evaluate({ inputSource: 'expression', expression }, {
				...scope, evaluatedParamValues: new Map([['export-id', value]]), paramIdsByName: new Map([['export', 'export-id']]),
			}, false, definition), isExport);
		}
	}
});
