import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { compileScript, parse } from 'vue/compiler-sfc';
import { createRenderer, h, nextTick } from 'vue';
import { i18nPlugin } from './helpers/i18n.mjs';

const directory = fileURLToPath(new URL('../', import.meta.url));
const descriptor = parse(await readFile(new URL('../src/components/GsTimelineExportDialog.vue', import.meta.url), 'utf8')).descriptor;
const script = compileScript(descriptor, { id: 'export-dialog-test' }).content;
const bundle = await build({
	absWorkingDir: directory, stdin: { loader: 'ts', resolveDir: `${directory}/src/components`, contents: script },
	bundle: true, platform: 'node', format: 'cjs', external: ['vue'], write: false,
	plugins: [i18nPlugin, { name: 'export-dialog-platform', setup(build) {
		build.onResolve({ filter: /\.vue$|(?:^|\/)(?:app|preferences|application-activity)\.ts$|\/export\/client\.ts$/ }, args => ({ path: args.path, namespace: 'platform' }));
		build.onLoad({ filter: /.*/, namespace: 'platform' }, args => ({ loader: 'ts', resolveDir: directory, contents: !args.path.endsWith('/app.ts')
			? 'export default {}; export const preferences = { s: {} }; export const applicationActivity = {}; export function exportTimeline() {}'
			: `
			import { ref } from 'vue';
			import { deepClone } from '@gs/shared/utility/deep-clone.ts';
			export const appContext = globalThis.exportDialogContext = {
				activeSceneId: ref('scene'), activeScene: ref({ id: 'scene' }),
				previewPlayback: { state: ref({ mode: 'timeline' }), currentTimelineTime: ref(0) },
				renderValidation: { errorMessage: ref(null) },
				projectContext: { generation: 1, stateManager: { state: {}, commits: [],
					commit(type, settings) { this.commits.push(type); this.state.exportSettings.value = deepClone(settings); }
				} },
			};
		` }));
	} }],
});
const bundled = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports);
const Dialog = { ...bundled.exports.default, render: () => null };
const context = globalThis.exportDialogContext;
delete globalThis.exportDialogContext;
const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null });

function fixture(t, savedSettings = null) {
	const stateManager = context.projectContext.stateManager;
	context.projectContext.generation = 1;
	context.previewPlayback.state.value = { mode: 'timeline' };
	context.activeScene.value = { id: 'scene' };
	stateManager.commits.length = 0;
	stateManager.state = Object.fromEntries(Object.entries({
		exportSettings: savedSettings, name: 'Project', resolution: { width: 1920, height: 1080 }, timelineFps: 24,
		generatedSpeech: [], timelineScenes: ['scene', 'other'].map((id, index) => ({ id, name: id, resolution: { mode: 'project' }, layers: [
			{ id: 'layer', layerType: 'effect', effectId: 'fill', clips: [{ id: 'clip', startMs: 0, durationMs: (index + 1) * 10000, contentOffsetMs: 0 }] },
		] })),
	}).map(([key, value]) => [key, { value }]));
	const open = () => {
		let input;
		const app = renderer.createApp({ render: () => h(Dialog, { ref: instance => { if (instance != null) input = instance.$.setupState; } }) });
		app.mount({});
		t.after(() => app.unmount());
		return { input, close: () => app.unmount() };
	};
	return { stateManager, open, ...open() };
}

// 【FPSの倍率はプロジェクトを基準にし、カスタム入力と出力の検証を切り替える】
// 解像度だけが倍率へ追従したり、表示FPSと書き出しFPSが食い違ったりしないようにする。
// 上限を超える倍率は黙って丸めずエラーにし、カスタムの小数FPSと静止画の奇数寸法も扱う。
test('resolves project frame rate scales and custom output settings', t => {
	const { input } = fixture(t);
	assert.deepEqual(input.scaleOptions.map(option => option.value), [0.25, 0.5, 1, 2, 4, 'custom']);
	for (const scale of [0.25, 0.5, 1, 2, 4]) {
		input.fpsScale = scale;
		assert.equal(input.fps, 24 * scale);
		assert.equal(input.settings.fps, 24 * scale);
		assert.equal(input.validationError, null);
	}
	input.fpsScale = 'custom';
	input.customFps = 29.97;
	input.resolutionScale = 'custom';
	input.customResolution = { width: 501, height: 777 };
	assert.equal(input.settings.fps, 29.97);
	assert.deepEqual(input.resolution, { width: 502, height: 778 });
	assert.equal(input.validationError, null);
	input.customFps = 121;
	assert.ok(input.validationError != null);
	input.mode = 'still';
	assert.equal(input.validationError, null);
	assert.deepEqual(input.resolution, { width: 501, height: 777 });
});

// 【閉じるだけでも全設定を保持し、次回表示で保存済みの時間範囲を初期化しない】
// 動画と静止画それぞれの品質・未選択のカスタム値も復元対象とする。
// 倍率を保存することで、再表示前のプロジェクト設定変更には新しい基準で追従する。
test('restores dialog choices and ranges after closing without exporting', t => {
	const f = fixture(t);
	Object.assign(f.input.dialogSettings, {
		mode: 'still', videoQuality: 'medium', stillQuality: 'lossless', resolutionScale: 0.5,
		customResolution: { width: 800, height: 600 }, fpsScale: 2, customFps: 23.976,
		startTime: '00:00:01.250', endTime: '00:00:07.750',
	});
	f.input.closeDialog();
	const saved = structuredClone(f.stateManager.state.exportSettings.value);
	f.close();
	f.stateManager.state.resolution.value = { width: 1280, height: 720 };
	f.stateManager.state.timelineFps.value = 30;
	const reopened = f.open();
	assert.deepEqual({ ...reopened.input.dialogSettings }, saved);
	assert.deepEqual(reopened.input.resolution, { width: 640, height: 360 });
	assert.equal(reopened.input.fps, 60);
	assert.equal(reopened.input.startTime, '00:00:01.250');
	assert.equal(reopened.input.endTime, '00:00:07.750');
	reopened.close();
	assert.deepEqual(f.stateManager.commits, ['changeExportSettings']);
});

// 【Sceneを変更すると新しい全範囲へ戻し、削除済みSceneの設定は現在のSceneで開く】
// 保存したSceneが消えていても無効な参照を保持せず、他Sceneの終了時刻を流用しない。
test('resets the range when selecting a different or replacing a missing scene', async t => {
	const f = fixture(t);
	f.input.sceneId = 'other';
	await nextTick();
	assert.equal(f.input.startTime, '00:00:00.000');
	assert.equal(f.input.endTime, '00:00:20.000');
	f.input.startTime = '00:00:01.000';
	f.close();
	f.stateManager.state.timelineScenes.value = f.stateManager.state.timelineScenes.value.filter(scene => scene.id !== 'other');
	const reopened = f.open();
	assert.equal(reopened.input.sceneId, 'scene');
	assert.equal(reopened.input.startTime, '00:00:00.000');
	assert.equal(reopened.input.endTime, '00:00:10.000');
});

// 【書き出しSceneが未選択なら先頭のSceneとその全範囲を選ぶ】
// Visual Module Live Previewから初めて開く場合や未選択の設定を復元する場合にも、毎回選び直す必要をなくす。
// 保存済みの有効な選択は優先し、Sceneが一つもない場合だけ未選択を維持する。
test('selects the first scene when no export scene is selected', t => {
	const f = fixture(t);
	f.close();
	f.stateManager.state.exportSettings.value = null;
	context.previewPlayback.state.value = { mode: 'visualModuleLivePreview' };
	context.activeScene.value = { id: 'other' };
	const initial = f.open();
	assert.equal(initial.input.sceneId, 'scene');
	assert.equal(initial.input.endTime, '00:00:10.000');
	initial.close();

	Object.assign(f.stateManager.state.exportSettings.value, { sceneId: '', startTime: '00:00:01.000', endTime: '00:00:05.000' });
	context.previewPlayback.state.value = { mode: 'timeline' };
	const restored = f.open();
	assert.equal(restored.input.sceneId, 'scene');
	assert.equal(restored.input.startTime, '00:00:00.000');
	assert.equal(restored.input.endTime, '00:00:10.000');
	restored.close();

	f.stateManager.state.exportSettings.value.sceneId = 'other';
	const selected = f.open();
	assert.equal(selected.input.sceneId, 'other');
	selected.close();

	f.stateManager.state.exportSettings.value = null;
	f.stateManager.state.timelineScenes.value = [];
	const empty = f.open();
	assert.equal(empty.input.sceneId, '');
	assert.equal(empty.input.endTime, '00:00:00.000');
});

// 【プロジェクト切替後のアンマウントでは旧ダイアログの設定を保存しない】
// ダイアログの片付けが新しいプロジェクトの初期化より後でも、設定が混入しないようにする。
test('does not save an old dialog into a replacement project', t => {
	const f = fixture(t);
	f.input.customFps = 29.97;
	context.projectContext.generation++;
	f.close();
	assert.equal(f.stateManager.state.exportSettings.value, null);
	assert.deepEqual(f.stateManager.commits, []);
});
