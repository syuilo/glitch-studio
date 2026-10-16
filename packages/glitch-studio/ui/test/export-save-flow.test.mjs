import { i18n } from './helpers/i18n.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { parse } from 'vue/compiler-sfc';
import { createSourceFile, isFunctionDeclaration, ScriptTarget } from 'typescript';
import { transform } from 'esbuild';

// コンポーネントの実際の入口を実行し、保存先選択・描画・保存の非同期の順序を検証する。
const source = await readFile(new URL('../src/components/GsTimelineExportDialog.vue', import.meta.url), 'utf8');
const ast = createSourceFile('GsTimelineExportDialog.ts', parse(source).descriptor.scriptSetup.content, ScriptTarget.Latest);
const handler = ast.statements.find(statement => isFunctionDeclaration(statement) && statement.name?.text === 'doExport');
const { code } = await transform(handler.getText(ast), { loader: 'ts' });

const { code: rendererAssetsCode } = await transform(await readFile(new URL('../src/utility/renderer-assets.ts', import.meta.url), 'utf8'),
	{ loader: 'ts', format: 'cjs' });
const rendererAssetsModule = { exports: {} };
new Function('module', 'exports', rendererAssetsCode)(rendererAssetsModule, rendererAssetsModule.exports);
const { getRendererAssets } = rendererAssetsModule.exports;

function fixture({ browser = false, choose = null, save = null, renderError = null } = {}) {
	const events = [];
	const ref = value => ({ value });
	const state = Object.fromEntries(Object.entries({
		resolution: { width: 1920, height: 1080 }, timelineFps: 30, timelineMotionBlur: {},
		assets: [], generatedSpeech: [], visualModules: [], timelineScenes: [],
	}).map(([key, value]) => [key, ref(value)]));
	const desktop = {
		async chooseExportSaveFile(name, format) {
			events.push(['choose', name, format]);
			return choose == null ? { id: 'target', name: 'chosen.mp4' } : choose();
		},
		async writeExportFile(id, data) { events.push(['save', id, [...data]]); await save?.(); },
		async releaseExportFile(id) { events.push(['release', id]); },
		async notifyExportComplete(name) { events.push(['notify', name]); },
	};
	const context = {
		i18n,
		dialogContent: ref(null), exporting: ref(false), choosingSaveFile: ref(false), savingFile: ref(false),
		validationError: ref(null), error: ref(''), status: ref(''), progress: ref(null),
		downloadUrl: ref('previous'), downloadName: ref('previous.mp4'),
		settings: ref({ format: 'mp4', quality: 'high', width: 1920, height: 1080, positionMs: 0, endTimeMs: 100, fps: 30 }),
		resolutionScale: ref(1), sceneId: ref('scene'), scene: ref({ name: 'Scene' }), projectName: ref('Project'),
		stateManager: { state }, preferences: { s: {} }, deepClone: structuredClone, getRendererAssets,
		getRequiredVoicevoxRequestsForRendering: () => [],
		appContext: {
			voicevoxGeneration: { async prepare() { events.push(['prepare']); return []; } },
			async suspendPreview() { events.push(['suspend']); },
			async resumePreview() { events.push(['resume']); },
		},
		async exportTimeline(_request, _signal, onProgress) {
			events.push(['render']);
			if (renderError != null) throw renderError;
			onProgress({ phase: 'finalizing', completedFrames: 3, totalFrames: 3 });
			return new Uint8Array([1, 2, 3]).buffer;
		},
		setTaskbarProgress: value => { events.push(['progress', value]); },
		navigator: { gpu: { getPreferredCanvasFormat: () => 'bgra8unorm' } },
		window: { desktop: browser ? null : desktop, document: {
			createElement() { return { click() { events.push(['download']); } }; },
		} },
		URL: {
			createObjectURL: () => 'download-url', revokeObjectURL: value => { events.push(['revoke', value]); },
		},
	};
	const actions = new Function('context', `const { ${Object.keys(context).join(', ')} } = context;
		let abortController = null; ${code}; return { doExport, abort: () => abortController?.abort() };`)(context);
	return { events, context, ...actions };
}

// 【保存ダイアログが閉じるまで音声生成・描画を開始せず、保存成功後にだけ通知する】
// ダイアログを先に出しても裏で描画を始めたり、ディスク書き込み前に完了通知を出したりしない。
test('waits for the save choice before rendering and for saving before notifying', async () => {
	const choice = Promise.withResolvers();
	const saved = Promise.withResolvers();
	const saving = Promise.withResolvers();
	const f = fixture({ choose: () => choice.promise, save: () => { saving.resolve(); return saved.promise; } });
	const job = f.doExport();
	assert.deepEqual(f.events, [['choose', 'Project-Scene.mp4', 'mp4']]);
	assert.equal(f.context.choosingSaveFile.value, true);
	choice.resolve({ id: 'selected', name: 'custom.mp4' });
	await saving.promise;
	assert.equal(f.context.savingFile.value, true);
	assert.equal(f.context.status.value, '');
	assert.equal(f.events.some(([name]) => name === 'notify' || name === 'download'), false);
	saved.resolve();
	await job;
	assert.deepEqual(f.events.filter(([name]) => ['choose', 'prepare', 'suspend', 'render', 'save', 'notify'].includes(name)), [
		['choose', 'Project-Scene.mp4', 'mp4'], ['prepare'], ['suspend'], ['render'],
		['save', 'selected', [1, 2, 3]], ['notify', 'custom.mp4'],
	]);
	assert.equal(f.context.status.value, 'Export complete.');
	assert.equal(f.context.exporting.value, false);
});

// 【保存ダイアログをキャンセルしたら描画せず、前回のダウンロードも保持する】
// 何も書き出していないのにプレビューを破棄したり、取得済みの出力を失ったりしない。
test('does not prepare or render when the save dialog is canceled', async () => {
	const f = fixture({ choose: () => null });
	await f.doExport();
	assert.deepEqual(f.events.filter(([name]) => name !== 'progress'), [['choose', 'Project-Scene.mp4', 'mp4']]);
	assert.equal(f.context.downloadUrl.value, 'previous');
	assert.equal(f.context.exporting.value, false);
	assert.equal(f.context.choosingSaveFile.value, false);
	assert.equal(f.context.error.value, '');
});

// 【保存先選択中に画面が閉じられた場合は、選択後も描画せずIDを解放する】
// OSダイアログのPromiseはAbortSignalでは中断できないため、戻った直後にも中止を確認する。
test('releases the selected target without rendering if aborted during the dialog', async () => {
	const choice = Promise.withResolvers();
	const f = fixture({ choose: () => choice.promise });
	const job = f.doExport();
	f.abort();
	choice.resolve({ id: 'abandoned', name: 'abandoned.mp4' });
	await job;
	assert.equal(f.events.some(([name]) => name === 'render' || name === 'save' || name === 'notify'), false);
	assert.ok(f.events.some(([name, id]) => name === 'release' && id === 'abandoned'));
	assert.equal(f.context.status.value, 'Export canceled.');
});

// 【描画や保存が失敗した場合は完了通知を出さず、プレビューと保存先IDを後始末する】
// 保存できなかった出力を成功扱いにせず、次回の書き出しやプレビューを利用できる状態に戻す。
test('reports rendering and saving failures without a completion notification', async () => {
	for (const options of [
		{ renderError: new Error('render failed') },
		{ save: () => { throw new Error('save failed'); } },
	]) {
		const f = fixture(options);
		await f.doExport();
		assert.match(f.context.error.value, /failed/);
		assert.equal(f.context.status.value, '');
		assert.equal(f.events.some(([name]) => name === 'notify' || name === 'download'), false);
		assert.ok(f.events.some(([name]) => name === 'release'));
		assert.ok(f.events.some(([name]) => name === 'resume'));
		assert.equal(f.context.exporting.value, false);
		assert.equal(f.context.savingFile.value, false);
	}
});

// 【ブラウザ版では生成後のダウンロードを引き続き使う】
// Electron専用APIが存在しない環境にも、保存先選択やネイティブ書き込みを要求しない。
test('keeps the download flow in the browser', async () => {
	const f = fixture({ browser: true });
	await f.doExport();
	assert.equal(f.events.some(([name]) => ['choose', 'save', 'notify'].includes(name)), false);
	assert.ok(f.events.some(([name]) => name === 'download'));
	assert.equal(f.context.downloadUrl.value, 'download-url');
	assert.equal(f.context.downloadName.value, 'Project-Scene.mp4');
	assert.equal(f.context.status.value, 'Export complete.');
});
