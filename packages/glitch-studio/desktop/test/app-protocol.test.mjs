import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { createAppProtocolHandler } from '../app-protocol.mjs';

// 【アプリ配信に隔離ヘッダーを付け、元の本文・MIME・ステータスを維持する】
// WorkerのCOEP漏れによる起動失敗を防ぎ、ヘッダー追加でファイルの配信条件を壊さない。
test('isolates app responses while preserving the streamed body and response metadata', async () => {
	const uiRoot = path.resolve('test-ui');
	const handler = createAppProtocolHandler({
		uiRoot, entryUrl: 'app://glitch-studio/', externalAssetFiles: null,
		fetchFile: async url => {
			assert.equal(url, pathToFileURL(path.join(uiRoot, 'worker.js')).href);
			return new Response('worker source', { status: 206, statusText: 'Partial Content', headers: {
				'Content-Type': 'text/javascript', 'Content-Range': 'bytes 0-12/20', 'Content-Length': '13',
			} });
		},
	});
	const response = await handler(new Request('app://glitch-studio/worker.js'));
	assert.equal(response.headers.get('Cross-Origin-Opener-Policy'), 'same-origin');
	assert.equal(response.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
	assert.equal(response.headers.get('Content-Type'), 'text/javascript');
	assert.equal(response.headers.get('Content-Range'), 'bytes 0-12/20');
	assert.equal(response.headers.get('Content-Length'), '13');
	assert.equal(response.status, 206);
	assert.equal(response.statusText, 'Partial Content');
	assert.equal(await response.text(), 'worker source');
});

for (const entryUrl of ['app://glitch-studio/', 'http://127.0.0.1:5173/']) {
	// 【外部参照素材の配信は実際のUIオリジンだけに許可する】
	// アプリの隔離設定と素材側のCORSを混同せず、開発時の動的ポートも引き継ぐ。
	test(`preserves external asset responses and the trusted origin for ${entryUrl}`, async () => {
		const assetResponse = new Response('asset', { status: 206 });
		const request = new Request('app://external-assets/registered-id');
		const handler = createAppProtocolHandler({
			uiRoot: path.resolve('test-ui'), entryUrl,
			externalAssetFiles: { respond(actualRequest, origin) {
				assert.equal(actualRequest, request);
				assert.equal(origin, entryUrl.slice(0, -1));
				return assetResponse;
			} },
			fetchFile: () => assert.fail('External assets must not use the bundled-file loader.'),
		});
		assert.equal(await handler(request), assetResponse);
	});
}

// 【配信対象外のパスと存在しないファイルを区別し、静的ファイルの権限を広げない】
// レスポンスの組み立て変更後も、別オリジンや不正なパスをファイル読み取りへ渡さない。
test('rejects paths outside the app and handles missing files', async () => {
	let fetched = false;
	const handler = createAppProtocolHandler({
		uiRoot: path.resolve('test-ui'), entryUrl: 'app://glitch-studio/', externalAssetFiles: null,
		fetchFile: async () => { fetched = true; throw new Error('Missing file'); },
	});
	assert.equal((await handler(new Request('app://other/index.html'))).status, 403);
	assert.equal((await handler(new Request('app://glitch-studio/..%2fsecret'))).status, 403);
	assert.equal(fetched, false);
	assert.equal((await handler(new Request('app://glitch-studio/missing.js'))).status, 404);
});
