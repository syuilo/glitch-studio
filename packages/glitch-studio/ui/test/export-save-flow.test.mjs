import { i18n } from './helpers/i18n.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parse } from 'vue/compiler-sfc';
import { createSourceFile, isFunctionDeclaration, ScriptTarget } from 'typescript';
import { build, transform } from 'esbuild';
import { getExportProgressFraction } from '../src/export/timeline-export.ts';

const activityBundle = await build({
	absWorkingDir: fileURLToPath(new URL('../', import.meta.url)), entryPoints: ['./src/application-activity.ts'],
	bundle: true, platform: 'node', format: 'cjs', external: ['vue'], write: false,
});
const activityModule = { exports: {} };
new Function('require', 'module', 'exports', activityBundle.outputFiles[0].text)(createRequire(import.meta.url), activityModule, activityModule.exports);
const { ApplicationActivity } = activityModule.exports;

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

function fixture({ browser = false, choose = null, save = null, suspend = null, resume = null, renderError = null } = {}) {
	const events = [];
	const exportRequests = [];
	const ref = value => ({ value });
	const state = Object.fromEntries(Object.entries({
		resolution: { width: 1920, height: 1080 }, timelineFps: 30, timelineMotionBlur: {},
		customShaderEffects: [], automationGraphs: [], assets: [], generatedSpeech: [], visualModules: [], timelineScenes: [],
	}).map(([key, value]) => [key, ref(value)]));
	let progressListener = null;
	const desktop = {
		onExportFileProgress(listener) { progressListener = listener; return () => { progressListener = null; }; },
		async chooseExportSaveFile(name, format) {
			events.push(['choose', name, format]);
			return choose == null ? { id: 'target', name: 'chosen.mp4' } : choose();
		},
		async writeExportFile(id, data) { events.push(['save', id, [...data]]); await save?.(); },
		async beginExportFile(id, totalBytes) { events.push(['begin-save', id, totalBytes]); },
		async appendExportFile(id, data) { events.push(['save', id, [...data]]); await save?.(); },
		async finishExportFile(id) { events.push(['finish-save', id]); },
		async releaseExportFile(id) { events.push(['release', id]); },
		async notifyExportComplete(name) { events.push(['notify', name]); },
	};
	const context = {
		getExportProgressFraction,
		saveExportSettings() {},
		applicationActivity: new ApplicationActivity(),
		i18n,
		dialogContent: ref(null), exporting: ref(false), choosingSaveFile: ref(false), savingFile: ref(false),
		validationError: ref(null), error: ref(''), status: ref(''), progress: ref(null),
		downloadUrl: ref('previous'), downloadName: ref('previous.mp4'),
		settings: ref({ format: 'mp4', quality: 'high', width: 1920, height: 1080, positionMs: 0, endTimeMs: 100, fps: 30 }),
		resolutionScale: ref(1), effectRenderTileDivisionLevel: ref(0), sceneId: ref('scene'), scene: ref({ name: 'Scene' }), projectName: ref('Project'),
		stateManager: { state }, preferences: { s: { enable32bitDataTextures: true, effectRenderTileDivisionLevel: 3 } }, deepClone: structuredClone, getRendererAssets,
		getRequiredVoicevoxRequestsForRendering: () => [],
		appContext: {
			voicevoxGeneration: { async prepare() { events.push(['prepare']); return []; } },
			async suspendPreview() { events.push(['suspend']); await suspend?.(); },
			async resumePreview() { events.push(['resume']); await resume?.(); },
		},
		async exportTimeline(request, _signal, onProgress, writeChunk) {
			exportRequests.push(request);
			events.push(['render']);
			if (renderError != null) throw renderError;
			onProgress({ phase: 'finalizing', completedFrames: 3, totalFrames: 3 });
			await writeChunk(new Uint8Array([1, 2, 3]), 3);
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
	return { events, exportRequests, context, ...actions, sendSaveProgress: value => progressListener?.(value), get hasProgressListener() { return progressListener != null; } };
}

// 【全出力形式でダイアログのタイル分割を使い、書き出し開始時の設定を保持する】
// 環境設定の値をそのまま渡すと、書き出しだけ分割を無効にしたり増やしたりできない。
// 保存先を選ぶ間に設定が変わっても、受け付けた書き出しの設定へ混入しないことを確認する。
test('passes the selected tile division to every export format using a snapshot', async () => {
	for (const [format, divisionLevel] of [['mp4', 0], ['webp', 2], ['exr', 4]]) {
		const choice = Promise.withResolvers();
		const f = fixture({ choose: () => choice.promise });
		if (format === 'webp') {
			f.context.settings.value = { format, quality: 'high', width: 1920, height: 1080, positionMs: 0 };
		} else if (format === 'exr') {
			f.context.settings.value = { format, compression: 'zip', width: 1920, height: 1080, positionMs: 0 };
		}
		f.context.effectRenderTileDivisionLevel.value = divisionLevel;
		const job = f.doExport();
		f.context.effectRenderTileDivisionLevel.value = 1;
		f.context.preferences.s.enable32bitDataTextures = false;
		choice.resolve({ id: 'target', name: `chosen.${format}` });
		await job;
		assert.equal(f.context.error.value, '');
		assert.equal(f.exportRequests.length, 1);
		assert.deepEqual(f.exportRequests[0].renderer, { enable32bitDataTextures: true, effectRenderTileDivisionLevel: divisionLevel });
		assert.equal(f.context.preferences.s.effectRenderTileDivisionLevel, 3);
	}
});

// 【保存中の進捗は現在の保存先IDだけを採用し、完了後に購読を解除する】
// 別ウィンドウの通知や前回の遅延通知で表示が書き換わらず、繰り返し書き出しても
// preloadのIPCリスナーが増え続けないことを確認する。
test('tracks only the current save target and unsubscribes after saving', async () => {
	const saving = Promise.withResolvers();
	const saved = Promise.withResolvers();
	const f = fixture({ save: () => { saving.resolve(); return saved.promise; } });
	const job = f.doExport();
	await saving.promise;
	f.sendSaveProgress({ id: 'other', completedBytes: 8, totalBytes: 10 });
	assert.equal(f.context.progress.value.completedBytes, 0);
	f.sendSaveProgress({ id: 'target', completedBytes: 2, totalBytes: 3 });
	assert.equal(f.context.progress.value.completedBytes, 2);
	assert.equal(f.hasProgressListener, true);
	saved.resolve();
	await job;
	assert.equal(f.hasProgressListener, false);
});

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
	assert.equal(f.context.applicationActivity.isExporting.value, true);
	choice.resolve({ id: 'selected', name: 'custom.mp4' });
	await saving.promise;
	assert.equal(f.context.savingFile.value, true);
	assert.equal(f.context.applicationActivity.isExporting.value, true);
	assert.equal(f.context.status.value, '');
	assert.equal(f.events.some(([name]) => name === 'notify' || name === 'download'), false);
	saved.resolve();
	await job;
	assert.deepEqual(f.events.filter(([name]) => ['choose', 'prepare', 'suspend', 'render', 'save', 'notify'].includes(name)), [
		['choose', 'Project-Scene.mp4', 'mp4'], ['prepare'], ['suspend'], ['render'],
		['save', 'selected', [1, 2, 3]], ['notify', 'custom.mp4'],
	]);
	assert.equal(f.context.exporting.value, false);
	assert.equal(f.context.applicationActivity.isExporting.value, false);
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
	assert.equal(f.context.applicationActivity.isExporting.value, false);
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
	assert.equal(f.context.applicationActivity.isExporting.value, false);
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
		assert.equal(f.context.applicationActivity.isExporting.value, false);
	}
});

// 【休止確認を待ってから書き出し、確認待ち中の中止・失敗でもプレビューを復帰する】
// Workerの休止は非同期なので、確認前にエンコーダーを起動してはいけない。
// 中止や休止途中の失敗でUIを非表示のまま残さず、保存先と終了防止も解放する。
test('waits for preview suspension and restores it after cancellation or suspension failure', async () => {
	for (const outcome of ['cancel', 'failure']) {
		const suspending = Promise.withResolvers();
		const suspended = Promise.withResolvers();
		const f = fixture({ suspend: () => { suspending.resolve(); return suspended.promise; } });
		const job = f.doExport();
		await suspending.promise;
		assert.equal(f.events.some(([name]) => name === 'render'), false);
		if (outcome === 'cancel') { f.abort(); suspended.resolve(); }
		else suspended.reject(new Error('suspension failed'));
		await job;
		assert.equal(f.events.some(([name]) => name === 'render' || name === 'save'), false);
		assert.ok(f.events.some(([name]) => name === 'resume'));
		assert.ok(f.events.some(([name]) => name === 'release'));
		assert.equal(f.context.applicationActivity.isExporting.value, false);
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
	assert.equal(f.context.applicationActivity.isExporting.value, false);
});

// 【プレビュー復帰中も終了防止を維持し、復帰に失敗しても保護を解除する】
// エクスポートの最後の後始末までアプリを保護しつつ、エラー後に終了不能な状態を残さない。
test('protects preview restoration and releases export activity even if restoration fails', async () => {
	const resuming = Promise.withResolvers();
	const resumed = Promise.withResolvers();
	const f = fixture({ resume: () => { resuming.resolve(); return resumed.promise; } });
	const job = f.doExport();
	await resuming.promise;
	assert.equal(f.context.applicationActivity.isExporting.value, true);
	resumed.reject(new Error('preview failed'));
	await job;
	assert.match(f.context.error.value, /preview failed/);
	assert.equal(f.context.applicationActivity.isExporting.value, false);
});
