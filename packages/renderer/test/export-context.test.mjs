import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { TimelineRenderer } from '../src/timeline-renderer.ts';
import { loadShaderSource } from './helpers/load-shader-source.mjs';
const { createVisualModuleTimelineLayer } = await loadShaderSource(fileURLToPath(new URL('../src/visual-module-timeline-layer.ts', import.meta.url)));

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
		createLayer: () => createVisualModuleTimelineLayer({ paramDefs: [] }, { paramValues: {}, automationGraphs: [] }, {
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

// 単独参照と複合式の両方で真偽値を評価し、繰り返し評価しても値が残らない。
test('evaluates IS_EXPORT in module and node expressions without leaking state', () => {
	const evaluator = new ParameterEvaluator();
	for (const isExport of [false, true, false, true, false]) {
		const scope = { variables: { IS_EXPORT: isExport }, automationGraphs: [], time: 0, endTime: 1000 };
		const value = evaluator.evaluate({ inputSource: 'expression', expression: 'IS_EXPORT' }, { ...scope, evaluatedParamValues: null }, false);
		assert.equal(value, isExport);
		for (const expression of ['IS_EXPORT', 'IS_EXPORT == true', 'PARAM("export")']) {
			assert.equal(evaluator.evaluate({ inputSource: 'expression', expression }, {
				...scope, evaluatedParamValues: new Map([['export-id', value]]), paramIdsByName: new Map([['export', 'export-id']]),
			}, false), isExport);
		}
	}
});
