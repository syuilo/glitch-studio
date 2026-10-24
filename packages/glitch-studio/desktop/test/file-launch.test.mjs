import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { test } from 'node:test';
import { FileLaunchController, launchFileProcess } from '../file-launch.mjs';
import { ProjectFiles } from '../project-files.mjs';
import { registerStartupFileIpc } from '../startup-file-ipc.mjs';

function fixture(startupProjectPath = null) {
	let mainWindow = null;
	const createdWindows = [];
	const launchedProjectPaths = [];
	const projectFiles = new ProjectFiles();
	const handlers = new Map();
	const controller = new FileLaunchController({
		startupFilePaths: startupProjectPath == null ? [] : [startupProjectPath],
		createWindow: () => { mainWindow = {}; createdWindows.push(mainWindow); },
		hasMainWindow: () => mainWindow != null,
		openFileInNewProcess: filePath => { launchedProjectPaths.push(filePath); },
	});
	registerStartupFileIpc({ handle: (name, handler) => handlers.set(name, handler) }, projectFiles, event => {
		if (mainWindow == null || event !== mainWindow) throw new Error('Untrusted');
		return mainWindow;
	}, () => controller.takeStartupFilePath());
	return { controller, createdWindows, launchedProjectPaths, projectFiles,
		takeStartupFile: () => handlers.get('desktop:take-startup-file')(mainWindow),
		takeStartupProject: () => handlers.get('desktop:take-startup-file')(mainWindow)?.file ?? null,
		takeUntrustedStartupProject: () => handlers.get('desktop:take-startup-file')({}),
		closeWindow: () => { mainWindow = null; projectFiles.clear(); },
	};
}

// 【ready前のファイル要求を保持し、最初の1件だけを起動ウィンドウに割り当てる】
// macOSのopen-fileは初期化完了前にも複数回届く。起動引数との重複を除き、
// 残りを別プロセスへ渡すことで、取りこぼしや最後のファイルによる上書きを防ぐ。
test('queues early requests, deduplicates the startup path and launches additional projects separately', () => {
	const firstProjectPath = path.resolve('作品 フォルダ', '試作.GSPROJ');
	const secondProjectPath = path.resolve('second.gsproj');
	const thirdProjectPath = path.resolve('third.gsproj');
	const h = fixture(firstProjectPath);
	assert.equal(h.controller.requestFile(firstProjectPath), true);
	assert.equal(h.controller.requestFile(secondProjectPath), true);
	assert.equal(h.controller.requestFile(thirdProjectPath), true);
	h.controller.activate();
	assert.equal(h.createdWindows.length, 0);
	assert.deepEqual(h.launchedProjectPaths, []);
	h.controller.start();
	h.controller.start();
	assert.equal(h.createdWindows.length, 1);
	assert.deepEqual(h.launchedProjectPaths, [secondProjectPath, thirdProjectPath]);
	assert.throws(h.takeUntrustedStartupProject, /Untrusted/);
	const descriptor = h.takeStartupProject();
	assert.equal(h.projectFiles.getPath(descriptor.id), firstProjectPath);
	assert.equal(descriptor.name, '試作.GSPROJ');
	assert.equal(h.takeStartupProject(), null);
});

// 【画像・動画を起動前・編集中・全ウィンドウ終了後のどの時点でも受け取る】
// 素材をプロジェクトの保存先として登録すると原本へ上書きしてしまう。
// 初期化前の重複通知をまとめ、他の要求は別プロセスに渡し、素材のパスとMIMEだけをUIへ返す。
test('delivers media once without registering it as a project and isolates additional files', () => {
	const imagePath = path.resolve('素材 フォルダ', '画像.PNG');
	const videoPath = path.resolve('動画.webm');
	const projectPath = path.resolve('作品.gsproj');
	const h = fixture(imagePath);
	h.controller.requestFile(imagePath);
	h.controller.requestFile(videoPath);
	h.controller.start();
	h.controller.requestFile(projectPath);
	assert.deepEqual(h.takeStartupFile(), { kind: 'media', path: imagePath, type: 'image/png' });
	assert.equal(h.takeStartupFile(), null);
	assert.deepEqual(h.launchedProjectPaths, [videoPath, projectPath]);
	assert.equal(h.createdWindows.length, 1);
	assert.throws(() => h.projectFiles.getPath(imagePath), /Unknown/);
	h.closeWindow();
	h.controller.requestFile(videoPath);
	assert.deepEqual(h.takeStartupFile(), { kind: 'media', path: videoPath, type: 'video/webm' });
	assert.equal(h.takeStartupFile(), null);
	assert.equal(h.createdWindows.length, 2);
	h.closeWindow();
	h.controller.activate();
	assert.equal(h.takeStartupFile(), null);
});

// 【起動中に届いた要求で、読込中のプロジェクトも編集中のプロジェクトも置き換えない】
// ウィンドウが存在するだけで分離するため、UIの準備前に2件目が届いても最初の読込先を維持できる。
test('opens live requests in another process without replacing the startup project', () => {
	const firstProjectPath = path.resolve('first.gsproj');
	const secondProjectPath = path.resolve('second.gsproj');
	const h = fixture(firstProjectPath);
	h.controller.start();
	h.controller.requestFile(secondProjectPath);
	assert.equal(h.projectFiles.getPath(h.takeStartupProject().id), firstProjectPath);
	h.controller.requestFile(firstProjectPath);
	assert.equal(h.createdWindows.length, 1);
	assert.deepEqual(h.launchedProjectPaths, [secondProjectPath, firstProjectPath]);
	assert.equal(h.takeStartupProject(), null);
});

// 【全ウィンドウを閉じた後も、macOSの残存プロセスで次のファイルを開ける】
// IPCハンドラを再登録せず、新しいウィンドウ向けのパスを取得する必要がある。
// ファイル指定のないDockからの再表示では、前のプロジェクトを再読込しない。
test('reuses a process without a window and does not reopen old projects on activation', () => {
	const h = fixture();
	h.controller.start();
	assert.equal(h.takeStartupProject(), null);
	h.closeWindow();
	const projectPath = path.resolve('reopened.gsproj');
	h.controller.requestFile(projectPath);
	assert.equal(h.createdWindows.length, 2);
	assert.equal(h.projectFiles.getPath(h.takeStartupProject().id), projectPath);
	assert.equal(h.takeStartupProject(), null);
	assert.deepEqual(h.launchedProjectPaths, []);
	h.closeWindow();
	h.controller.activate();
	h.controller.activate();
	assert.equal(h.createdWindows.length, 3);
	assert.equal(h.takeStartupProject(), null);
});

// 【未対応形式のファイルや相対パスをOSのオープン要求として扱わない】
// Dockへのドロップで任意の種類のファイルが届いても、プロジェクト読込や別プロセスの起動へ流さない。
test('rejects invalid project requests before and after startup', () => {
	const h = fixture();
	const invalidPaths = [null, '', 'relative.gsproj', path.resolve('document.txt')];
	for (const filePath of invalidPaths) assert.equal(h.controller.requestFile(filePath), false);
	h.controller.start();
	for (const filePath of invalidPaths) assert.equal(h.controller.requestFile(filePath), false);
	assert.equal(h.createdWindows.length, 1);
	assert.equal(h.takeStartupProject(), null);
	assert.deepEqual(h.launchedProjectPaths, []);
});

// 【配布版と開発版の起動引数を分け、空白や日本語を含むパスをそのまま子プロセスへ渡す】
// 配布版にアプリのディレクトリを渡すとファイル引数がずれ、開発版で省くとElectronがアプリを読めない。
// detachedとunrefにより、元プロセスの終了で新しい編集ウィンドウを終了させない。
test('launches packaged and development applications with independent project arguments', async t => {
	const executablePath = path.resolve('Glitch Studio');
	const projectPath = path.resolve('作品 フォルダ', '試作.gsproj');
	for (const applicationPath of [null, path.resolve('app directory')]) {
		const child = new EventEmitter();
		child.unref = t.mock.fn();
		const spawnProcess = t.mock.fn(() => child);
		const launched = launchFileProcess(projectPath, { executablePath, applicationPath, spawnProcess });
		assert.equal(child.unref.mock.callCount(), 0);
		child.emit('spawn');
		await launched;
		assert.equal(child.unref.mock.callCount(), 1);
		assert.deepEqual(spawnProcess.mock.calls[0].arguments, [executablePath,
			applicationPath == null ? [projectPath] : [applicationPath, projectPath],
			{ detached: true, stdio: 'ignore', windowsHide: true }]);
	}
});

// 【プロセスの起動失敗を呼び出し元へ返し、ユーザーへのエラー表示を可能にする】
// spawnのerrorイベントを購読しないと、失敗を報告できない上に元の編集プロセスまで異常終了する。
test('reports synchronous and asynchronous process launch errors', async () => {
	const projectPath = path.resolve('project.gsproj');
	const child = new EventEmitter();
	const launched = launchFileProcess(projectPath, { spawnProcess: () => child });
	child.emit('error', new Error('Cannot start the application'));
	await assert.rejects(launched, /Cannot start the application/);
	await assert.rejects(launchFileProcess(projectPath, { spawnProcess: () => { throw new Error('Invalid executable'); } }), /Invalid executable/);
});
