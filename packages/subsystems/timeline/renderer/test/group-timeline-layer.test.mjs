import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';

const directory = fileURLToPath(new URL('../', import.meta.url));
// 評価順と設定の寿命は実際のレンダラーで確認し、GPUへ送る合成処理だけを置き換える。
const bundle = await build({
	absWorkingDir: directory,
	stdin: { resolveDir: directory, loader: 'ts', contents: `
		export { createGroupTimelineLayer } from './src/layers/group/group-timeline-layer.ts';
		export { TimelineCompositingParameters } from './src/timeline-compositing-parameters.ts';
		export { TimelineEvaluationSession } from './src/timeline-evaluation.ts';
		export { createTimelineContainerLayer } from '@gs/subsystems_timeline_shared/container-layer.ts';
	` },
	bundle: true, platform: 'node', format: 'cjs', write: false,
	plugins: [{ name: 'group-compositor', setup(build) {
		build.onResolve({ filter: /timeline-compositor\.ts$/ }, () => ({ path: 'compositor', namespace: 'test' }));
		build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ loader: 'ts', contents: `
			export function createTimelineCompositor() {
				return {
					evaluate(context, source, settings, projected) {
						return { output: { source, settings, projected }, gpuTime: 0 };
					},
					dispose() {},
				};
			}
		` }));
	} }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { createGroupTimelineLayer, TimelineCompositingParameters, TimelineEvaluationSession, createTimelineContainerLayer } = module.exports;
const fallback = { kind: 'uniform', value: [0, 0, 0, 0] };

function fixture(t, { empty = false, waitForChild = async () => {} } = {}) {
	const group = createTimelineContainerLayer('group', 'group', 'Group');
	group.layers = empty ? [] : [{ id: 'child', layerType: 'image', isDisabled: false, clips: [{ id: 'clip', startMs: 0, durationMs: 1000, contentOffsetMs: 0 }] }];
	group.compositingParamValues.opacity = { inputSource: 'expression', expression: 'TIME' };
	group.compositingParamValues.position = { inputSource: 'expression', expression: '[TIME, 0]' };
	const evaluationTimes = [];
	const evaluateSettings = TimelineCompositingParameters.prototype.evaluate;
	t.mock.method(TimelineCompositingParameters.prototype, 'evaluate', function(context) {
		evaluationTimes.push(context.time);
		return evaluateSettings.call(this, context);
	});
	const renderer = createGroupTimelineLayer(() => group, {
		resolution: { width: 1920, height: 1080 },
		createLayer: () => ({
			async evaluate(context) {
				await waitForChild(context);
				return { output: { kind: 'uniform', value: [1, 1, 1, 1] }, gpuTime: 0 };
			},
			destroy() {},
		}),
		getLayerVersion: () => 0,
	});
	t.after(() => renderer.destroy());
	return {
		group,
		evaluationTimes,
		prepare(time) {
			const signal = new globalThis.AbortController().signal;
			const context = { sceneTimeMs: time, contentTimeMs: time, timeDelta: 0, isExport: false, getInput: async () => fallback };
			const options = { time, timeDelta: 0, isExport: false, signal, session: new TimelineEvaluationSession(fallback), getInput: context.getInput };
			// RendererManagerもcontextをコピーする。設定の保存先をcontextの同一性へ依存させない。
			context.childEvaluation = renderer.createChildren({ ...context }, options);
			return { context, signal };
		},
		evaluate: ({ context, signal }) => renderer.evaluate({ ...context }, signal),
	};
}

// 【Group設定は各サンプルで一度だけ評価し、子の準備から合成まで同じ結果を使う】
// 式・Automation Graphを二重に評価せず、次のサンプルでは新しい時刻の値を取得する必要がある。
test('evaluates group settings once per sample and refreshes them for subsequent samples', async t => {
	const f = fixture(t);
	const first = await f.evaluate(f.prepare(100));
	assert.equal(first.output.settings.opacity, 0.1);
	assert.deepEqual(first.output.settings.position, [0.1, 0]);
	assert.equal(first.output.projected, false);
	assert.deepEqual(f.evaluationTimes, [100]);
	const second = await f.evaluate(f.prepare(700));
	assert.equal(second.output.settings.opacity, 0.7);
	assert.deepEqual(second.output.settings.position, [0.7, 0]);
	assert.deepEqual(f.evaluationTimes, [100, 700]);
});

// 【後発評価が先に完了しても、待機中の評価へ別の設定・合成モードを混ぜない】
// シークや編集で非同期の子評価が交錯するため、「最新の設定」一個では子の描画空間と合成が食い違う。
test('keeps settings and compositing mode isolated when evaluations finish out of order', async t => {
	const gates = new Map([200, 800].map(time => [time, { started: Promise.withResolvers(), finish: Promise.withResolvers() }]));
	const f = fixture(t, { waitForChild: async context => {
		const gate = gates.get(context.sceneTimeMs);
		gate.started.resolve();
		await gate.finish.promise;
	} });
	const earlier = f.prepare(200);
	f.group.compositingMode = 'preserveDepth';
	f.group.compositingParamValues.opacity = { inputSource: 'literal', value: 0.8 };
	const later = f.prepare(800);
	const pendingEarlier = f.evaluate(earlier);
	await gates.get(200).started.promise;
	const pendingLater = f.evaluate(later);
	await gates.get(800).started.promise;
	// 両方の準備後にも保存設定を編集し、完了時に設定を読み直していないことを確かめる。
	f.group.compositingMode = 'flat';
	f.group.compositingParamValues.opacity = { inputSource: 'literal', value: 1 };
	gates.get(800).finish.resolve();
	const resultLater = await pendingLater;
	gates.get(200).finish.resolve();
	const resultEarlier = await pendingEarlier;
	assert.equal(resultEarlier.output.settings.opacity, 0.2);
	assert.deepEqual(resultEarlier.output.settings.position, [0.2, 0]);
	assert.equal(resultEarlier.output.projected, false);
	assert.equal(resultLater.output.settings.opacity, 0.8);
	assert.deepEqual(resultLater.output.settings.position, [0.8, 0]);
	assert.equal(resultLater.output.projected, true);
	assert.deepEqual(f.evaluationTimes, [200, 800]);
});

// 【子に映像出力がないGroupでも、準備済み設定の再評価や追加合成を行わない】
// 空白区間では設定評価一回のまま終了し、背景へ透明画像を重ねる副作用も避ける。
test('does not reevaluate settings or composite when the group has no child output', async t => {
	const f = fixture(t, { empty: true });
	assert.deepEqual(await f.evaluate(f.prepare(300)), { gpuTime: 0 });
	assert.deepEqual(f.evaluationTimes, [300]);
});
