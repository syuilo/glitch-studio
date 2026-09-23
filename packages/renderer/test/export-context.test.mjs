import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { TimelineRenderer } from '../src/timeline-renderer.ts';
import { createVisualModuleTimelineLayer } from '../src/visual-module-timeline-layer.ts';

const bundled = await build({
	entryPoints: [fileURLToPath(new URL('../src/parameter-evaluator.ts', import.meta.url))],
	bundle: true, platform: 'node', format: 'cjs', write: false,
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { ParameterEvaluator } = module.exports;

// エクスポート指定をレイヤー変換まで伝え、後続の通常シークには残さない。
test('passes export context through timeline layers and resets it for preview', async () => {
	const contexts = [];
	const renderer = new TimelineRenderer({
		fallbackOutput: null,
		createLayer: () => createVisualModuleTimelineLayer({ paramDefs: [] }, { paramValues: {} }, {
			async prepare() {},
			async render(context) { contexts.push(context); return { gpuTime: 0 }; },
			destroy() {},
		}),
		present() {},
	});
	const timeline = [{ id: 'layer', startTimeMs: 0, endTimeMs: 1000 }];
	await renderer.renderAt(0, timeline, 0, true);
	await renderer.renderAt(100, timeline, 100, true);
	await renderer.renderAt(200, timeline);
	assert.deepEqual(contexts.map(context => context.isExport), [true, true, false]);
	renderer.clear();
});

// 単独参照と複合式の両方で真偽値を評価し、Interpreterの再利用でも値が残らない。
test('evaluates IS_EXPORT in module and node expressions without leaking state', () => {
	const evaluator = new ParameterEvaluator();
	const bool = { dataType: 'bool', ui: { control: 'switch' } };
	const context = {
		nodes: [{ id: 'node', type: 'effect', effectId: 'test', params: {
			direct: { inputSource: 'expression', expression: 'IS_EXPORT' },
			compound: { inputSource: 'expression', expression: 'IS_EXPORT == true' },
		} }],
		paramDefs: [{ ...bool, id: 'export', name: 'export', defaultValue: { inputSource: 'literal', value: false } }],
		paramValues: { export: { inputSource: 'expression', expression: 'IS_EXPORT' } },
		effectDefinitions: { test: { paramDefs: { direct: bool, compound: bool } } },
		automationGraphs: [], resolution: { width: 100, height: 100 }, time: 0, endTime: 1000, inputParamIds: new Set(),
	};
	for (const isExport of [undefined, true, false, true, undefined]) {
		const result = evaluator.evaluate({ ...context, isExport });
		assert.equal(result.paramValues.get('export'), isExport ?? false);
		assert.deepEqual(result.nodeParams.get('node'), { direct: isExport ?? false, compound: isExport ?? false });
	}
});
