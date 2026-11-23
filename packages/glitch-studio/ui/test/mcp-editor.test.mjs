import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const directory = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({
	absWorkingDir: directory, bundle: true, platform: 'node', format: 'cjs', write: false,
	stdin: { resolveDir: directory, loader: 'ts', contents: `
		export { connectMcpEditor } from './src/mcp/editor-connection.ts';
		export { captureProjectPreview, seekTimelineAndCapture } from './src/mcp/capture-preview.ts';
		export { ref, shallowRef, nextTick } from 'vue';
	` },
	plugins: [{ name: 'mcp-effects', setup(build) {
		build.onResolve({ filter: /(?:effect-definitions|native-effects[\\/]definitions)\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'test' }));
		build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ loader: 'ts', resolveDir: directory, contents: `
			import fill from '@gs/subsystems_effect_native-effects/fx/fill/_def_.ts';
			export const nativeEffectDefinitions = { fill };
		` }));
	} }],
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
const { connectMcpEditor, captureProjectPreview, seekTimelineAndCapture, ref, shallowRef, nextTick } = loaded.exports;
const deferred = () => Promise.withResolvers();

function session(id) {
	const calls = [];
	return { id, isDisposed: false, projectDisplayName: ref(`Unsaved ${id}`), activeSceneId: ref('scene'), calls,
		scripting: { isRunning: ref(false), runExternal: async (...args) => { calls.push(args); return { output: ['done'], error: null, outputTruncated: false, commandsExecuted: 0 }; } } };
}

function connection(initialSessions, capture) {
	const summaries = [];
	const responses = [];
	const pending = new Map();
	let requestListener = null;
	let cancelListener = null;
	let sequence = 0;
	const projectSessions = { sessions: shallowRef(initialSessions), activeSession: shallowRef(initialSessions[0] ?? null) };
	const desktop = {
		onMcpRequest: listener => { requestListener = listener; return () => { requestListener = null; }; },
		onMcpCancel: listener => { cancelListener = listener; return () => { cancelListener = null; }; },
		respondMcpRequest: async response => { responses.push(response); pending.get(response.requestId)?.resolve(response); },
		updateMcpProjectSessions: async value => { assert.notEqual(requestListener, null); summaries.push(value); },
	};
	const disconnect = connectMcpEditor(projectSessions, desktop, capture);
	return { summaries, responses, projectSessions, cancel: id => cancelListener(id),
		disconnect: () => { desktop.updateMcpProjectSessions = async value => { summaries.push(value); }; disconnect(); },
		request: (operation, input) => {
			const requestId = `request-${++sequence}`;
			const result = deferred();
			pending.set(requestId, result);
			requestListener({ requestId, operation, input });
			return { requestId, response: result.promise };
		} };
}

// 【未保存Projectを一覧へ含め、名前・選択・実行中状態を追従させる】
// 保存先の存在をセッション識別に使うと、新規プロジェクトをMCPから編集できなくなる。
test('registers unsaved sessions and updates their active and running summaries', async () => {
	const first = session('first');
	const second = session('second');
	const fixture = connection([first, second]);
	assert.deepEqual(fixture.summaries.at(-1), [
		{ projectSessionId: 'first', name: 'Unsaved first', isActive: true, isScriptRunning: false, activeSceneId: 'scene' },
		{ projectSessionId: 'second', name: 'Unsaved second', isActive: false, isScriptRunning: false, activeSceneId: 'scene' },
	]);
	first.projectDisplayName.value = 'Renamed';
	second.scripting.isRunning.value = true;
	fixture.projectSessions.activeSession.value = second;
	assert.equal(fixture.summaries.at(-1)[0].name, 'Renamed');
	assert.equal(fixture.summaries.at(-1)[1].isActive, true);
	assert.equal(fixture.summaries.at(-1)[1].isScriptRunning, true);
	const result = await fixture.request('execute_script', { projectSessionId: 'first', source: '<: "run"' }).response;
	assert.equal(result.ok, true);
	assert.equal(first.calls[0][0], '<: "run"');
	assert.equal(second.calls.length, 0);
	const missing = await fixture.request('execute_script', { projectSessionId: 'closed', source: '' }).response;
	assert.equal(missing.error.code, 'PROJECT_CLOSED');
	fixture.disconnect();
	assert.deepEqual(fixture.summaries.at(-1), []);
});

// 【契約資料は実装済みのCommand・Queryカタログをそのまま提供する】
// MCP用の別定義を持つと、名前・説明・入力形式がパネルと食い違うため既存カタログを通す。
test('serves scripting contracts and enforces the bounded reference request', async () => {
	const fixture = connection([]);
	const search = await fixture.request('search_scripting_api', { query: 'setProjectName' }).response;
	assert.equal(search.ok, true);
	assert.ok(search.result.some(result => result.name === 'Command:setProjectName'));
	const reference = await fixture.request('get_scripting_api', { names: ['Command:setProjectName', 'Query:getProject'] }).response;
	assert.equal(reference.ok, true);
	assert.equal(reference.result[0].name, 'Command:setProjectName');
	assert.equal(reference.result[1].name, 'Query:getProject');
	const excessive = await fixture.request('get_scripting_api', { names: Array(6).fill('Query:getProject') }).response;
	assert.equal(excessive.ok, false);
	fixture.disconnect();
});

// 【MCP要求の中断とセッション終了は実行先のAbortSignalまで伝播する】
// UIがIPC要求を忘れるだけでは、閉じたProjectへ非同期Commandが遅れて適用されてしまう。
test('cancels pending scripts on request cancellation and session removal', async () => {
	const project = session('first');
	const signals = [];
	project.scripting.runExternal = async (_source, signal) => {
		signals.push(signal);
		return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
	};
	const fixture = connection([project]);
	const cancelled = fixture.request('execute_script', { projectSessionId: 'first', source: '' });
	fixture.cancel(cancelled.requestId);
	assert.equal((await cancelled.response).error.code, 'CANCELLED');
	assert.equal(signals[0].aborted, true);
	const closed = fixture.request('execute_script', { projectSessionId: 'first', source: '' });
	fixture.projectSessions.sessions.value = [];
	assert.equal((await closed.response).error.code, 'CANCELLED');
	assert.equal(signals[1].aborted, true);
	fixture.disconnect();
});

// 【画像取得は選択中Projectだけに限定し、取得中の切替と同時要求を検出する】
// 隠れたタブの停止Canvasを返したり、別タブの画素を指定Projectの画像として返してはならない。
test('requires the selected preview and rejects overlap or selection changes', async () => {
	const first = session('first');
	const second = session('second');
	const image = deferred();
	const calls = [];
	const fixture = connection([first, second], async (...args) => { calls.push(args); return image.promise; });
	assert.equal((await fixture.request('capture_preview', { projectSessionId: 'second' }).response).error.code, 'PREVIEW_INACTIVE');
	const capture = fixture.request('capture_preview', { projectSessionId: 'first' });
	assert.equal(calls[0][1], 1024);
	assert.equal((await fixture.request('capture_preview', { projectSessionId: 'first' }).response).error.code, 'PROJECT_BUSY');
	assert.equal((await fixture.request('execute_script', { projectSessionId: 'first', source: '' }).response).error.code, 'PROJECT_BUSY');
	fixture.projectSessions.activeSession.value = second;
	image.resolve({ data: 'PNG' });
	assert.equal((await capture.response).error.code, 'PREVIEW_CHANGED');
	fixture.disconnect();
});

function previewSession() {
	const capture = deferred();
	const called = deferred();
	let flushes = 0;
	const controller = { canvasRevision: ref(1), capturePreview: (...args) => { called.resolve(args); return capture.promise; } };
	return { capture, called, flushes: () => flushes, session: {
		id: 'preview', isDisposed: false, flushRendererProjectChanges: async () => { flushes++; },
		renderEngine: { canRender: ref(true), errorMessage: ref(null), isSuspended: ref(false) },
		previewPlayback: { state: shallowRef({ mode: 'timeline', playing: false }), currentTimelineTime: ref(123) },
		activeSceneId: ref('scene'), activePreviewRenderer: shallowRef(controller), timelineRendererManagerController: controller, effectLivePreviewManagerController: controller,
	} };
}

// 【静的設定変更でWorkerが再起動したときは同期完了後のフレームを取得する】
// 取得APIの返す寸法・時刻・対象とPNGを結び付け、古いCanvasの読み取りを防ぐ。
test('waits for a restarted renderer and returns capture metadata with PNG bytes', async () => {
	const fixture = previewSession();
	fixture.session.renderEngine.canRender.value = false;
	const result = captureProjectPreview(fixture.session, 512, new AbortController().signal);
	await nextTick();
	fixture.session.renderEngine.canRender.value = true;
	assert.deepEqual(await fixture.called.promise, [512, 123]);
	assert.equal(fixture.flushes(), 2);
	fixture.capture.resolve({ blob: new Blob(['PNG'], { type: 'image/png' }), width: 512, height: 288, time: 124 });
	assert.deepEqual(await result, { data: 'UE5H', mimeType: 'image/png', width: 512, height: 288, projectSessionId: 'preview',
		target: { kind: 'timeline', sceneId: 'scene' }, timeMs: 124, colorSpace: 'srgb', includesPreviewAdjustments: true });
});

// 【キャプチャ中にSceneやCanvas世代が変わった場合は画像を破棄する】
// 新しい対象の情報と古い画像を組み合わせてクライアントへ返してはならない。
test('discards capture results after the preview target changes', async () => {
	const fixture = previewSession();
	const result = captureProjectPreview(fixture.session, 512, new AbortController().signal);
	await fixture.called.promise;
	fixture.session.activeSceneId.value = 'different-scene';
	fixture.capture.resolve({ blob: new Blob(['PNG']), width: 512, height: 288, time: 123 });
	await assert.rejects(result, /PREVIEW_CHANGED/);
});

// 【選択中のCustom Shader Effectを撮影し、同じIDのCustom Node Graph Effectと区別する】
// 同じRendererとCanvasを使うため、撮影中の種別変更はプレビュー対象の状態で判定する。
test('captures a shader preview and detects switching to a graph with the same ID', async () => {
	for (const switchToGraph of [false, true]) {
		const fixture = previewSession();
		const playback = fixture.session.previewPlayback;
		playback.state.value = { mode: 'effectLivePreview', effectSource: { type: 'customShaderEffectReference', id: 'shared' } };
		const result = captureProjectPreview(fixture.session, 512, new AbortController().signal);
		assert.deepEqual(await fixture.called.promise, [512]);
		if (switchToGraph) playback.state.value = { mode: 'effectLivePreview', effectSource: { type: 'customNodeGraphEffectReference', id: 'shared' } };
		fixture.capture.resolve({ blob: new Blob(['PNG']), width: 512, height: 288, time: 123 });
		if (switchToGraph) await assert.rejects(result, /PREVIEW_CHANGED/);
		else assert.deepEqual((await result).target, { kind: 'customShaderEffect', customShaderEffectId: 'shared' });
	}
});

function seekFixture() {
	const fixture = previewSession();
	const playback = fixture.session.previewPlayback;
	playback.isTimelinePlaying = ref(true);
	playback.pauseTimeline = () => { playback.isTimelinePlaying.value = false; playback.state.value = { mode: 'timeline', playing: false }; };
	playback.seekTimeline = time => { playback.currentTimelineTime.value = Math.round(time / 40) * 40; };
	return fixture;
}

// 【再生を停止し通常のフレーム境界にシークして、描画された時刻を返す】
// クライアントが要求時刻と実際の画面を区別でき、失敗時にも別Sceneを動かさない。
test('seeks the selected Scene and returns the actual frame and playback state', async () => {
	const fixture = seekFixture();
	await assert.rejects(seekTimelineAndCapture(fixture.session, 'other', 101, 512, new AbortController().signal), /SCENE_NOT_ACTIVE/);
	assert.equal(fixture.session.previewPlayback.isTimelinePlaying.value, true);
	const result = seekTimelineAndCapture(fixture.session, 'scene', 101, 512, new AbortController().signal);
	assert.deepEqual(await fixture.called.promise, [512, 120]);
	fixture.capture.resolve({ blob: new Blob(['PNG']), width: 512, height: 288, time: 120 });
	const image = await result;
	assert.equal(image.requestedTimeMs, 101);
	assert.equal(image.timeMs, 120);
	assert.equal(image.wasPlaying, true);
	assert.equal(fixture.session.previewPlayback.isTimelinePlaying.value, false);
});

// 【取得中に手動で移動して元へ戻しても別のフレームを返さない】
// 同じ最終時刻だけを比べると、介在したユーザー操作と取得画像を誤って対応付ける。
test('rejects intervening seeks and frames rendered at another time', async () => {
	for (const change of ['seek', 'frame']) {
		const fixture = seekFixture();
		const result = seekTimelineAndCapture(fixture.session, 'scene', 120, 512, new AbortController().signal);
		await fixture.called.promise;
		if (change === 'seek') {
			fixture.session.previewPlayback.currentTimelineTime.value = 160;
			fixture.session.previewPlayback.currentTimelineTime.value = 120;
		}
		fixture.capture.resolve({ blob: new Blob(['PNG']), width: 512, height: 288, time: change === 'frame' ? 160 : 120 });
		await assert.rejects(result, /PREVIEW_CHANGED/);
	}
});

// 【シーク要求を選択中Projectへ振り分け、取得中の切替も検出する】
// 切り替えた後に元へ戻した場合も、異なるセッションで取得された画像を成功として返さない。
test('routes timeline seeking and rejects an intervening project selection', async () => {
	const first = session('first');
	const second = session('second');
	const playback = seekFixture().session.previewPlayback;
	first.previewPlayback = playback;
	const image = deferred();
	const fixture = connection([first, second], async () => image.promise);
	const pending = fixture.request('seek_timeline_and_capture', { projectSessionId: 'first', sceneId: 'scene', timeMs: 120 });
	fixture.projectSessions.activeSession.value = second;
	fixture.projectSessions.activeSession.value = first;
	image.resolve({ target: { kind: 'timeline', sceneId: 'scene' }, timeMs: 120 });
	assert.equal((await pending.response).error.code, 'PREVIEW_CHANGED');
	fixture.disconnect();
});

// 【シーク後の中断でユーザーの位置を巻き戻さない】
// 取得待ちの間に操作された位置を、キャンセルの後始末が上書きしないようにする。
test('leaves the current timeline position intact when capture is cancelled', async () => {
	const fixture = seekFixture();
	const controller = new AbortController();
	const result = seekTimelineAndCapture(fixture.session, 'scene', 120, 512, controller.signal);
	await fixture.called.promise;
	fixture.session.previewPlayback.currentTimelineTime.value = 200;
	controller.abort(new Error('cancelled'));
	await assert.rejects(result, /cancelled/);
	assert.equal(fixture.session.previewPlayback.currentTimelineTime.value, 200);
	assert.equal(fixture.session.previewPlayback.isTimelinePlaying.value, false);
});
