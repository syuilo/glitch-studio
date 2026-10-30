import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';

const result = await build({
	stdin: { contents: `export { PreviewRenderEngine } from './PreviewRenderEngine.ts';
		export { formatRenderFailureOrigin } from './utility/render-failure.ts';`,
	resolveDir: fileURLToPath(new URL('../src', import.meta.url)), loader: 'ts' },
	bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { PreviewRenderEngine, formatRenderFailureOrigin } = module.exports;

// 【素材準備中の通常再試行と古い準備完了ではエンジンを再生成しない】
// 同じ編集のノード通知やプレビュー設定変更も再試行を要求するため、素材更新側のawaitだけでは
// 再生成を抑止できない。最後の素材更新だけが最新スナップショットの生成を許可する必要がある。
test('blocks retries during resource updates and only completes the latest update', async () => {
	let created = 0, disposed = 0;
	const engine = new PreviewRenderEngine({ create: async () => { created++; }, dispose: () => { disposed++; } });
	await engine.enable();
	const first = engine.beginResourceUpdate();
	assert.equal(engine.canRender.value, false);
	assert.equal(disposed, 1);
	engine.requestRetry();
	await engine.retry();
	const latest = engine.beginResourceUpdate();
	first.cancel();
	await first.complete();
	assert.equal(first.isCurrent(), false);
	assert.equal(latest.isCurrent(), true);
	assert.equal(created, 1);
	await latest.complete();
	assert.equal(created, 2);
	assert.equal(engine.canRender.value, true);
});

// 【素材準備の完了・取消しで書き出しの休止や新プロジェクトの初期化を解除しない】
// 素材更新とエクスポートは寿命が異なる。停止中に素材が準備できてもGPUを再取得せず、
// 購読解除後の古い完了通知が別プロジェクトのプレビューを作り直すことも防ぐ。
test('keeps explicit suspension independent of resource completion and cancellation', async () => {
	let created = 0;
	const engine = new PreviewRenderEngine({ create: async () => { created++; }, dispose() {} });
	await engine.enable();
	const update = engine.beginResourceUpdate();
	engine.suspend();
	await update.complete();
	assert.equal(engine.isSuspended.value, true);
	assert.equal(created, 1);
	await engine.resume();
	assert.equal(created, 2);
	const cancelled = engine.beginResourceUpdate();
	cancelled.cancel();
	await cancelled.complete();
	assert.equal(created, 2);
	await engine.retry();
	assert.equal(created, 3);
});

// 【実行状態の解放後も発生元の診断を保持し、再試行で解除する】
// エンジンの破棄時にEffectStateStoreは消える。修正すべき場所まで失わないよう、
// 発生元は別の診断として破棄前に保存し、再生成開始時にだけ解除する。
test('retains failure locations independently of disposed execution state and clears them on retry', async () => {
	const source = { type: 'timelineLayer', instanceId: 'instance', rootSceneId: 'root',
		layerId: 'visualModuleLayer', clipId: 'clip', layerPath: ['sceneLayer', 'placement', 'visualModuleLayer'] };
	const states = new Map([['node', { status: 'error' }]]);
	let reason;
	const engine = new PreviewRenderEngine({ create: async () => {}, dispose: error => { states.clear(); reason = error; } });
	await engine.enable();
	const failure = new Error('decode failed');
	engine.fail(failure, { source, nodeId: 'node' });
	assert.equal(states.size, 0);
	assert.equal(reason, failure);
	assert.deepEqual(engine.runtimeDiagnostic.value, { message: 'decode failed', origin: { source, nodeId: 'node' } });
	assert.equal(engine.canRender.value, false);
	await engine.retry();
	assert.equal(engine.runtimeDiagnostic.value, null);
	assert.equal(engine.canRender.value, true);
	engine.fail(new Error('GPU device lost'));
	assert.equal(engine.runtimeDiagnostic.value.origin, undefined);
	assert.equal(engine.errorMessage.value, 'GPU device lost');
});

// 【Visual Module Live Previewの発生元をプレビューの現在の選択から独立して表示する】
// 停止後に別のVisual Moduleを選択しても、元の失敗通知のIDから場所を表示する。
test('describes the failing Visual Module Live Preview Visual Module and node by their own identities', () => {
	const origin = { source: { type: 'visualModuleLivePreview', instanceId: 'instance', visualModuleId: 'visualModule' }, nodeId: 'node' };
	const visualModules = [{ id: 'visualModule', name: 'Source', nodes: [{ id: 'node', type: 'effect', displayName: 'Blur' }] }];
	assert.equal(formatRenderFailureOrigin(origin, visualModules, []), 'Visual Module Live Preview / Visual Module "Source" (visualModule) / Node "Blur" (node)');
});

// 【子Scene内のノードの発生元を配置クリップまで区別する】
// 同じ子Sceneを複数のクリップで使っても原因の配置を特定できる必要がある。
// Group配下のレイヤーも同じSceneのID探索で解決し、登録・Inline双方のノードを表示する。
for (const layerType of ['visualModule', 'inlineVisualModule']) {
	test(`describes nested scene placements and grouped nodes in a ${layerType} layer`, () => {
		const visualModule = { id: 'visualModule', nodes: [{ id: 'node', type: 'effect', displayName: 'Noise' }] };
		const childLayer = { id: 'childLayer', name: 'Effects', layerType, visualModuleId: visualModule.id, visualModule,
			clips: [{ id: 'childClip', startMs: 500 }] };
		const scenes = [{ id: 'root', name: 'Main', layers: [{ id: 'sceneLayer', name: 'Child scene', layerType: 'scene',
			clips: [{ id: 'first', sceneId: 'child', startMs: 0 }, { id: 'second', sceneId: 'child', startMs: 2000 }] }] },
		{ id: 'child', layers: [{ id: 'group', layerType: 'group', layers: [childLayer] }] }];
		const source = { type: 'timelineLayer', rootSceneId: 'root', layerId: 'childLayer', clipId: 'childClip',
			layerPath: ['sceneLayer', 'second', 'childLayer'], instanceId: 'instance' };
		assert.equal(formatRenderFailureOrigin({ source, nodeId: 'node' }, [visualModule], scenes),
			'Scene "Main" (root) / Layer "Child scene" (sceneLayer) / Clip at 2s (second) / Layer "Effects" (childLayer) / Clip at 0.5s (childClip) / Node "Noise" (node)');
		assert.equal(formatRenderFailureOrigin({ source, nodeId: 'node' }, [visualModule], scenes).includes('Clip at 0s (first)'), false);
	});
}

// 【発生元が編集で削除されても保持したIDを表示し、レイヤー単体の失敗も扱う】
// 診断の表示自体が参照切れで失敗してはいけない。ノードIDのないEffectレイヤーと、
// ノード・Sceneが既に見つからない場合の双方で場所を失わないことを確認する。
test('falls back to retained IDs for missing targets and handles layer failures without node IDs', () => {
	const source = { type: 'timelineLayer', rootSceneId: 'root', layerId: 'effectLayer', clipId: 'clip',
		layerPath: ['effectLayer'], instanceId: 'instance' };
	assert.equal(formatRenderFailureOrigin({ source }, [], []), 'Scene "root" / Layer "effectLayer" / Clip "clip"');
	assert.equal(formatRenderFailureOrigin({ source, nodeId: 'node' }, [], []), 'Scene "root" / Layer "effectLayer" / Clip "clip" / Node "node"');
});
