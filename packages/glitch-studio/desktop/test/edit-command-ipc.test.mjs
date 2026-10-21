import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerEditCommandIpc } from '../edit-command-ipc.mjs';

// 【送信元を検証した四種類の編集コマンドだけを実行する】
// 任意のwebContentsメソッドや、別ウィンドウからの操作をIPC経由で実行させない。
test('executes only trusted editing commands on the requesting main window', () => {
	const calls = [];
	const trusted = {};
	let invoke;
	const webContents = Object.fromEntries(['copy', 'paste', 'cut', 'delete'].map(command => [command, () => calls.push(command)]));
	registerEditCommandIpc({ handle(name, handler) { assert.equal(name, 'desktop:execute-edit-command'); invoke = handler; } }, event => {
		if (event !== trusted) throw new Error('Untrusted sender');
		return { webContents };
	});
	for (const command of ['copy', 'paste', 'cut', 'delete']) invoke(trusted, command);
	assert.deepEqual(calls, ['copy', 'paste', 'cut', 'delete']);
	assert.throws(() => invoke({}, 'cut'), /Untrusted/);
	assert.throws(() => invoke(trusted, 'executeJavaScript'), /Unsupported/);
	assert.throws(() => invoke(trusted, null), /Unsupported/);
	assert.equal(calls.length, 4);
});
