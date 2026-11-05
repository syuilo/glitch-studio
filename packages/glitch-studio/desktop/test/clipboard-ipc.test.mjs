import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerClipboardIpc } from '../clipboard-ipc.mjs';

// 【送信元を検証し、文字列だけを全編集ウィンドウ共通のOSクリップボードで受け渡す】
// 任意のIPC送信元や文字列でないデータを、ネイティブのクリップボードへ渡さない。
test('shares text through the system clipboard only for trusted editor windows', async () => {
	const handlers = new Map();
	const firstWindow = {};
	const secondWindow = {};
	let text = 'initial';
	const clipboard = { async readText() { return text; }, async writeText(value) { text = value; } };
	registerClipboardIpc({ handle(name, handler) { handlers.set(name, handler); } }, clipboard, event => {
		if (event !== firstWindow && event !== secondWindow) throw new Error('Untrusted sender');
	});
	const read = handlers.get('desktop:read-clipboard-text');
	const write = handlers.get('desktop:write-clipboard-text');
	await write(firstWindow, 'copied parameter');
	assert.equal(await read(secondWindow), 'copied parameter');
	await assert.rejects(read({}), /Untrusted/);
	await assert.rejects(write({}, 'bad'), /Untrusted/);
	await assert.rejects(write(firstWindow, {}), /must be a string/);
	assert.equal(text, 'copied parameter');
});
