import { createEffectInstance } from '@gs/subsystems_effect_renderer/create-effect-instance.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TimelineRenderer } from '@gs/subsystems_timeline_renderer/timeline-renderer.ts';
import { createTimelineEffectProbe } from './helpers/timeline-effect-probe.mjs';

globalThis.GPUQueue = class { submit() {} };

// エクスポート指定をレイヤー変換まで伝え、後続の通常シークには残さない。
test('passes export context through timeline layers and resets it for preview', async () => {
	const contexts = [];
	const renderer = new TimelineRenderer({
		fallbackOutput: { kind: 'texture', texture: { width: 1, height: 1, createView: () => ({}) } },
		createLayer: () => createTimelineEffectProbe({ render: frame => contexts.push(frame) }),
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
test('evaluates IS_EXPORT in public parameters and node expressions without leaking state', async t => {
	const flag = { dataType: { kind: 'bool' }, defaultValue: { inputSource: 'literal', value: false }, ui: { label: 'Export', control: {} } };
	const metadata = { primaryInputParameter: null, primaryOutput: 'output', outputDefs: { output: { dataType: { kind: 'color' } } }, resolutionInputParameters: [] };
	const graph = { ...metadata, paramDefs: { external: flag }, nodes: [{ id: 'draw', effectSource: { type: 'nativeEffect', id: 'probe' },
		params: { direct: { inputSource: 'expression', expression: 'IS_EXPORT' }, public: { inputSource: 'expression', expression: 'PUBLIC("external")' } } }],
		outputSources: { output: { nodeId: 'draw', outputPort: 'output' } } };
	const observed = [];
	const instance = await createEffectInstance({ effectSource: { type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: graph },
		resolution: { width: 4, height: 4 }, usedOutputPorts: new Set(['output']), params: { external: { inputSource: 'expression', expression: 'IS_EXPORT' } },
		definitions: { getNativeEffect: () => ({ ...metadata, paramDefs: { direct: flag, public: flag } }) } }, {}, () => ({
			createOutputTexture: () => ({ destroy() {} }), init: ({ inputs }) => ({ render: () => observed.push([inputs.direct.value, inputs.public.value]), dispose() {} }),
		}));
	t.after(() => instance.dispose());
	for (const isExport of [false, true, false, true, false]) instance.render({ time: 0, timeDelta: 0, isExport }, {});
	assert.deepEqual(observed, [false, true, false, true, false].map(flag => [flag, flag]));
});
