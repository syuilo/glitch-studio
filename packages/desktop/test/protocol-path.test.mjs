import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { resolveAppPath } from '../protocol-path.mjs';

const root = path.resolve('test-ui');
// トップページとURLエンコードされたアセットを解決できる。
test('resolves app entry and encoded assets', () => {
	assert.equal(resolveAppPath('app://glitch-studio/', root), path.join(root, 'index.html'));
	assert.equal(resolveAppPath('app://glitch-studio/assets/a%20b.js?v=1', root), path.join(root, 'assets/a b.js'));
});
// 配信ディレクトリ外へのアクセスやWindows固有のパスを拒否する。
test('rejects other origins and paths outside the bundle', () => {
	for (const url of [
		'https://glitch-studio/index.html', 'app://other/index.html',
		'app://glitch-studio/..%2fsecret', 'app://glitch-studio/%2e%2e%5csecret',
		'app://glitch-studio/C:%5csecret', 'app://glitch-studio/file:stream',
		'app://glitch-studio/%00',
	]) assert.equal(resolveAppPath(url, root), null, url);
});
