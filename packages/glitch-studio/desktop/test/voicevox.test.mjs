import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VoicevoxClient, registerVoicevoxIpc } from '../voicevox.mjs';

// 【ローカル接続先の検証とHTTPエラーの通知】
// プロジェクトの文字列を任意のURLへ送信する汎用IPCにせず、失敗した接続先を採用しない。
test('accepts local engine origins and rejects external URLs and failed requests', async () => {
	const calls = [];
	const client = new VoicevoxClient(async url => { calls.push(url); return Response.json(url.endsWith('/version') ? 'test' : []); });
	assert.deepEqual(await client.connect('http://localhost:50022'), { version: 'test', speakers: [] });
	assert.equal(client.endpoint, 'http://localhost:50022');
	for (const url of ['https://localhost', 'http://example.com', 'http://localhost/path', 'http://user:pass@localhost', 'http://localhost/?x=1']) await assert.rejects(client.connect(url));
	assert.equal(calls.length, 2);
	client.fetch = async () => new Response('', { status: 500 });
	await assert.rejects(client.connect('http://127.0.0.1:50021'), /HTTP 500/);
	assert.equal(client.endpoint, 'http://localhost:50022');
});

// 【解析結果を維持して話速と出力レートを指定し、同じ接続先で合成する】
// パラメータのエンコード漏れや、接続変更中のエンジン混在を防ぐ。
test('passes query data to synthesis and pins the endpoint for a complete request', async () => {
	const calls = [];
	const client = new VoicevoxClient(async (url, init) => {
		calls.push([url, init]);
		if (url.endsWith('/version')) return Response.json('test');
		if (url.includes('/audio_query')) { client.endpoint = 'http://localhost:50022'; return Response.json({ accent_phrases: ['test'], speedScale: 1 }); }
		return new Response(Uint8Array.of(1, 2, 3));
	});
	const result = await client.synthesize({ text: '日本語 & ?', styleId: 7, speedScale: 1.5 });
	assert.equal(new URL(calls[1][0]).searchParams.get('text'), '日本語 & ?');
	assert.equal(new URL(calls[1][0]).searchParams.get('speaker'), '7');
	assert.ok(calls.every(([url]) => url.startsWith('http://127.0.0.1:50021/')));
	assert.deepEqual(JSON.parse(calls[2][1].body), { accent_phrases: ['test'], speedScale: 1.5, outputSamplingRate: 48000 });
	assert.deepEqual(result.data, Uint8Array.of(1, 2, 3));
});

// 【信頼したElectronウィンドウだけに音声生成を公開する】
// APIの通信より先に既存のIPC送信元検証を行い、外部ページからの要求を拒否する。
test('checks the trusted sender before invoking the engine', async () => {
	const handlers = new Map();
	const trusted = {};
	let calls = 0;
	registerVoicevoxIpc({ handle: (name, handler) => handlers.set(name, handler) }, event => { if (event !== trusted) throw new Error('Untrusted'); }, {
		connect: () => { calls++; }, synthesize: () => { calls++; },
	});
	for (const handler of handlers.values()) {
		assert.throws(() => handler({}), /Untrusted/);
		await handler(trusted);
	}
	assert.equal(calls, 2);
});
