import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { FileLaunchController } from '../file-launch.mjs';

function fixture(startupFilePaths = []) {
	const created = [];
	let activeWindow = false;
	let allowed = true;
	const controller = new FileLaunchController({ startupFilePaths,
		createWindow: filePath => { created.push(filePath); activeWindow = true; },
		activateWindow: () => activeWindow, canOpen: () => allowed });
	return { controller, created, closeAll: () => { activeWindow = false; }, block: () => { allowed = false; } };
}

// 【初期化前の要求を保持し、起動引数との重複を除いて各ファイルを別ウィンドウへ渡す】
// macOSのopen-fileと起動引数が重なっても、取りこぼしや余分なダッシュボードを作らない。
test('queues early requests and creates one editor per file without an extra dashboard', () => {
	const first = path.resolve('作品 フォルダ', '試作.GSPROJ');
	const second = path.resolve('画像.PNG');
	const third = path.resolve('動画.webm');
	const { controller, created } = fixture([first]);
	controller.requestFile(first); controller.requestFile(second); controller.requestFile(third);
	controller.activate();
	assert.deepEqual(created, []);
	controller.start(); controller.start();
	assert.deepEqual(created, [first, second, third]);
});

// 【明示的な追加起動では新しいダッシュボードを作り、Dockからの再表示では既存画面を使う】
// 単一インスタンス化しても、ファイル指定なしの追加起動で新しい編集画面を開く操作を維持する。
test('creates dashboards for explicit launches and reuses existing windows on activation', () => {
	const { controller, created, closeAll } = fixture();
	controller.requestLaunch([]); controller.start();
	assert.deepEqual(created, [null, null]);
	controller.requestLaunch([]); controller.activate();
	assert.deepEqual(created, [null, null, null]);
	closeAll(); controller.activate(); controller.activate();
	assert.deepEqual(created, [null, null, null, null]);
});

// 【起動後の複数ファイル要求も別ウィンドウへ送り、更新・終了準備中の新規要求は拒否する】
// 初期化前に受けた要求と、編集中に関連付けから受けた要求を同じ入口で扱う。
// 更新の排他を取得した後に作品を増やして、未確認の変更を更新で失わないようにする。
test('routes later files and refuses new launches during update or quit preparation', () => {
	const { controller, created, block } = fixture();
	controller.start();
	const filePaths = [path.resolve('first.gsproj'), path.resolve('second.gsproj')];
	controller.requestLaunch(filePaths);
	assert.deepEqual(created, [null, ...filePaths]);
	block(); controller.requestLaunch([]); controller.requestLaunch(filePaths); controller.activate();
	assert.equal(controller.requestFile(filePaths[0]), false);
	assert.equal(created.length, 3);
});

// 【未対応形式や相対パスをOSのファイルオープン要求として扱わない】
// 対応していないファイルを、プロジェクトや素材として読み込むことを防ぐ。
test('rejects unsupported files and relative paths', () => {
	const { controller, created } = fixture();
	for (const filePath of [null, '', 'relative.gsproj', path.resolve('document.txt')]) assert.equal(controller.requestFile(filePath), false);
	controller.start();
	assert.deepEqual(created, [null]);
});
