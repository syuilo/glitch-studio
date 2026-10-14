import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build, transform } from 'esbuild';
import { parse } from 'vue/compiler-sfc';
import { createSourceFile, isFunctionDeclaration, ScriptTarget } from 'typescript';

const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/utility/file-drop.ts', import.meta.url))],
	bundle: true, platform: 'node', format: 'cjs', write: false });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { installFileDropHandlers } = module.exports;

function fixture(t, onDrop, isApplicationBlocked = () => false) {
	const document = new EventTarget();
	const registrations = [];
	let blocked = false;
	document.body = { hasAttribute: () => blocked };
	const original = document.addEventListener.bind(document);
	document.addEventListener = (name, listener, options) => { registrations.push([name, options]); original(name, listener, options); };
	const errors = [];
	const dispose = installFileDropHandlers(document, onDrop, error => errors.push(error), isApplicationBlocked);
	t.after(dispose);
	function dispatch(name, files, extra = {}, path = null) {
		const event = new Event(name, { cancelable: true });
		let stopped = false;
		const stop = event.stopPropagation.bind(event);
		event.stopPropagation = () => { stopped = true; stop(); };
		event.dataTransfer = { types: ['Files'], files, items: [], dropEffect: 'move', ...extra };
		if (path != null) event.composedPath = () => path;
		document.dispatchEvent(event);
		return { event, stopped };
	}
	return { document, registrations, errors, dispose, dispatch, block: value => { blocked = value; } };
}

// 【全体ドロップをキャプチャで一度だけ受け付け、FileListを非同期処理の前に保存する】
// 子パネルのstopPropagationより先に処理し、イベント終了後に空になるFileListに依存しない。
// 取り込み中の再ドロップも別の取り込みとして並行開始しない。
test('captures external files synchronously and prevents duplicate imports while busy', async t => {
	const gate = Promise.withResolvers();
	const imported = [];
	const f = fixture(t, async files => { await gate.promise; imported.push(files); });
	assert.ok(f.registrations.every(([_name, options]) => options.capture === true));
	const files = [new File(['a'], 'a.png'), new File(['b'], 'b.mp4')];
	const over = f.dispatch('dragover', files);
	assert.equal(over.event.defaultPrevented, true);
	assert.equal(over.event.dataTransfer.dropEffect, 'copy');
	const drop = f.dispatch('drop', files);
	assert.equal(drop.stopped, true);
	assert.equal(drop.event.defaultPrevented, true);
	drop.event.dataTransfer.files.length = 0;
	f.dispatch('drop', [new File(['c'], 'c.png')]);
	gate.resolve();
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(imported[0].map(file => file.name), ['a.png', 'b.mp4']);
	assert.equal(imported.length, 1);
	f.dispose();
	f.dispatch('drop', [new File(['d'], 'd.png')]);
	assert.equal(imported.length, 1);
});

// 【内部ドラッグを妨げず、progressなどによる操作ロック中はファイルを取り込まない】
// WorkspacePanelの移動・並べ替えは既存の子コンポーネントが処理する。
// inert中のファイルドロップでもブラウザによるファイル表示は防ぐ。
test('leaves internal drags unchanged and rejects file drops while the application is inert', t => {
	let count = 0;
	const f = fixture(t, async () => { count++; });
	const internal = f.dispatch('dragover', [], { types: ['misskey/workspacepanel'] });
	assert.equal(internal.event.defaultPrevented, false);
	assert.equal(internal.stopped, false);
	assert.equal(internal.event.dataTransfer.dropEffect, 'move');
	f.dispatch('drop', [], { types: ['misskey/workspacepanel'] });
	f.block(true);
	assert.equal(f.dispatch('dragover', []).event.dataTransfer.dropEffect, 'none');
	const drop = f.dispatch('drop', [new File(['a'], 'a.png')]);
	assert.equal(drop.event.defaultPrevented, true);
	assert.equal(count, 0);
});

// 【別ウィンドウのドロップも、メイン画面の取り込み中は受け付けない】
// PiPや別ウィンドウ自身のbodyにはinertがないため、アプリ全体の操作ロックを別途参照する。
test('respects the application lock when receiving drops in another document', async t => {
	let blocked = true;
	let imported = 0;
	const f = fixture(t, async () => { imported++; }, () => blocked);
	assert.equal(f.dispatch('dragover', []).event.dataTransfer.dropEffect, 'none');
	f.dispatch('drop', [new File(['a'], 'a.png')]);
	assert.equal(imported, 0);
	blocked = false;
	f.dispatch('drop', [new File(['a'], 'a.png')]);
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(imported, 1);
});

// 【Dashboardなどの専用ドロップ対象にはキャプチャ段階で干渉しない】
// 専用側でプロジェクトを開く操作が、全体側の素材取り込みに横取りされないようにする。
// 別ウィンドウ由来でも使えるよう、要素のクラスではなくドロップ対象の属性で判定する。
test('leaves dedicated drop targets to their own dragover and drop handlers', t => {
	let imported = 0;
	const f = fixture(t, async () => { imported++; });
	const target = { hasAttribute: name => name === 'data-file-drop-target' };
	const files = [new File(['project'], 'project.gsproj')];
	for (const name of ['dragover', 'drop']) {
		const result = f.dispatch(name, files, {}, [{}, target, f.document]);
		assert.equal(result.event.defaultPrevented, false);
		assert.equal(result.stopped, false);
	}
	assert.equal(imported, 0);
});

const source = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8');
const ast = createSourceFile('App.ts', parse(source).descriptor.scriptSetup.content, ScriptTarget.Latest);
const handler = ast.statements.find(statement => isFunctionDeclaration(statement) && statement.name?.text === 'onFileDrop');
const { code } = await transform(handler.getText(ast), { loader: 'ts' });

function appFixture({ hasProject = false, ids = ['asset'] } = {}) {
	const events = [];
	const context = {
		appContext: { projectContext: { hasProject } },
		newProject: async () => { events.push('newProject'); },
		importAssets: async (_context, files, prepare) => {
			if (ids.length > 0) await prepare();
			events.push(['assets', files.map(file => file.name)]);
			return ids;
		},
		openProject: async () => { assert.fail('Global drops must not open projects'); },
		workspaceController: { revealPanel: request => { events.push(['reveal', request]); } },
	};
	const run = new Function('context', 'events', `const { ${Object.keys(context).join(', ')} } = context;
		${code}; return onFileDrop;`)(context, events);
	return { events, run };
}

// 【アプリ全体のドロップでは素材を取り込み、完了後にAssetsを開く】
// 編集中のプロジェクトは新規作成せず、Dashboardやプロジェクトファイルの開閉に関与しない。
// アプリ全体からの表示要求はsourcePanelIdをnullにし、操作元タブに拘束されない。
test('initializes a project only when needed and reveals assets after successful batch import', async () => {
	for (const hasProject of [false, true]) {
		const f = appFixture({ hasProject });
		await f.run([new File(['a'], 'a.png'), new File(['b'], 'b.mp4')]);
		assert.equal(f.events.includes('newProject'), !hasProject);
		assert.deepEqual(f.events.slice(-2), [['assets', ['a.png', 'b.mp4']], ['reveal', { contentType: 'assets', sourcePanelId: null }]]);
	}
	const failed = appFixture({ ids: [] });
	await failed.run([new File(['bad'], 'bad.bin')]);
	assert.deepEqual(failed.events, [['assets', ['bad.bin']]]);
});

// 【アプリ全体へのgsprojドロップはプロジェクトを開かない】
// 素材として使えないファイルの失敗を通知する共通経路を使い、既存プロジェクトを置き換えない。
test('does not open project files through the global asset drop handler', async () => {
	const f = appFixture({ hasProject: true, ids: [] });
	await f.run([new File(['project'], 'project.gsproj')]);
	assert.deepEqual(f.events, [['assets', ['project.gsproj']]]);
});

const dashboardSource = await readFile(new URL('../src/components/GsDashboardDialog.vue', import.meta.url), 'utf8');
const dashboardAst = createSourceFile('GsDashboardDialog.ts', parse(dashboardSource).descriptor.scriptSetup.content, ScriptTarget.Latest);
const dashboardHandlers = dashboardAst.statements.filter(statement => isFunctionDeclaration(statement)
	&& ['onDrop', 'onDragover', '_newProjectFromImageOrVideo'].includes(statement.name?.text));
const { code: dashboardCode } = await transform(dashboardHandlers.map(handler => handler.getText(dashboardAst)).join('\n'), { loader: 'ts' });

function dashboardFixture({ ids = ['asset'], opened = true, hasProject = false } = {}) {
	const events = [];
	const context = {
		appContext: { projectContext: { hasProject } },
		newProject: async () => { events.push('newProject'); },
		newProjectFromImageOrVideo: async file => { events.push(['media', file ?? null]); return opened; },
		importAssets: async (_context, files, prepare) => {
			if (ids.length > 0) await prepare();
			events.push(['assets', files.map(file => file.name)]);
			return ids;
		},
		openProject: async (file, handle) => { events.push(['project', file.name, handle]); return opened; },
		workspaceController: { revealPanel: request => events.push(['reveal', request]) },
		modal: { value: { close: () => events.push('close') } },
		window: { document: { body: { hasAttribute: () => false } } },
		ui: { alert: async options => events.push(['error', options.text]) },
	};
	const handlers = new Function('context', `const { ${Object.keys(context).join(', ')} } = context;
		let importing = false; ${dashboardCode}; return { onDrop, onDragover, openMedia: _newProjectFromImageOrVideo };`)(context);
	return { events, ...handlers };
}

function dashboardEvent(files, items = []) {
	const event = new Event('drop', { cancelable: true });
	event.dataTransfer = { types: ['Files'], files, items };
	return event;
}

// 【Dashboardがプロジェクトの保存先ハンドルをdrop中に取得し、成功時だけ閉じる】
// 全体ドロップとは独立した受付で、プロジェクトを開く機能を維持する。
// ハンドル取得失敗はFileからの読み込みへフォールバックし、読み込み失敗時はDashboardを残す。
test('opens project files in the dashboard and requests handles synchronously', async () => {
	for (const opened of [false, true]) {
		const f = dashboardFixture({ opened });
		const handle = { kind: 'file' };
		let requested = false;
		const event = dashboardEvent([new File(['project'], 'project.GSPROJ')], [{ kind: 'file',
			getAsFileSystemHandle() { requested = true; return Promise.resolve(handle); } }]);
		const pending = f.onDrop(event);
		assert.equal(requested, true);
		assert.equal(event.defaultPrevented, true);
		await pending;
		assert.deepEqual(f.events[0], ['project', 'project.GSPROJ', handle]);
		assert.equal(f.events.includes('close'), opened);
	}
	const rejected = dashboardFixture();
	await rejected.onDrop(dashboardEvent([new File(['project'], 'project.gsproj')], [{ kind: 'file',
		getAsFileSystemHandle: () => Promise.reject(new Error('No handle')) }]));
	assert.deepEqual(rejected.events, [['project', 'project.gsproj', null], 'close']);
});

// 【Dashboardへの複数素材ドロップは新規プロジェクト作成後にまとめて追加する】
// 単一素材のみの旧処理へ戻らず、素材を追加できなかった場合にはDashboardを閉じない。
test('imports multiple assets in the dashboard and closes it only after successful import', async () => {
	const f = dashboardFixture();
	await f.onDrop(dashboardEvent([new File(['a'], 'a.png'), new File(['b'], 'b.mp4')]));
	assert.deepEqual(f.events, ['newProject', ['assets', ['a.png', 'b.mp4']], ['reveal', { contentType: 'assets', sourcePanelId: null }], 'close']);
	const failed = dashboardFixture({ ids: [] });
	await failed.onDrop(dashboardEvent([new File(['bad'], 'bad.bin')]));
	assert.deepEqual(failed.events, [['assets', ['bad.bin']]]);
});

// 【Dashboardへの単一メディアドロップはOpen image/video/audioと同じ新規作成を使う】
// 汎用のアセット取り込みでは、素材に合わせたノード・レイヤー・解像度の初期設定が行われない。
// 画像・動画・音声すべてで同じ入口を呼び、既存プロジェクトの有無によって挙動を変えない。
// 作成に失敗した場合も、ファイル選択と同様にDashboardを閉じない。
test('opens single dropped media through the same project factory as the file picker', async () => {
	for (const type of ['image/png', 'video/mp4', 'audio/wav']) {
		for (const opened of [false, true]) {
			const file = new File(['media'], 'source', { type });
			const dropped = dashboardFixture({ opened, hasProject: true });
			await dropped.onDrop(dashboardEvent([file]));
			assert.deepEqual(dropped.events, opened ? [['media', file], 'close'] : [['media', file]]);
			const selected = dashboardFixture({ opened });
			await selected.openMedia();
			assert.deepEqual(selected.events, opened ? [['media', null], 'close'] : [['media', null]]);
		}
	}
});

// 【単一フォントのドロップはメディア新規作成へ渡さずアセットとして取り込む】
// Open image/video/audioではフォントを扱えないため、既存のフォント取り込み経路を維持する。
test('keeps single font drops on the asset import path', async () => {
	const f = dashboardFixture();
	await f.onDrop(dashboardEvent([new File(['font'], 'font.ttf', { type: 'font/ttf' })]));
	assert.deepEqual(f.events, ['newProject', ['assets', ['font.ttf']], ['reveal', { contentType: 'assets', sourcePanelId: null }], 'close']);
});
