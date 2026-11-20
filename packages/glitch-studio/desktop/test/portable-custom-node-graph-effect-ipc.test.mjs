import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { registerPortableCustomNodeGraphEffectIpc } from '../portable-custom-node-graph-effect-ipc.mjs';

function fixture() {
	const handlers = new Map();
	const children = [];
	const sender = Object.assign(new EventEmitter(), { id: 1 });
	const event = { sender };
	registerPortableCustomNodeGraphEffectIpc({ handle: (name, handler) => handlers.set(name, handler) }, { fork(worker, args) {
		assert.equal(worker, 'worker.mjs'); assert.deepEqual(args, ['catalog']);
		const child = Object.assign(new EventEmitter(), { kills: 0, messages: [], kill() { this.kills++; }, postMessage(message) { this.messages.push(message); } });
		children.push(child);
		return child;
	} }, 'worker.mjs', 'catalog', request => { if (request !== event) throw new Error('Untrusted'); });
	return { handlers, sender, children, invoke: (name, ...args) => handlers.get(`desktop:${name}`)(event, ...args) };
}

// 【要求元ごとのビルドを一つに制限し、成功・異常終了の両方で再試行できる】
// 別作品の結果が混ざることと、プロセス異常で永久に処理中となることを防ぐ。
test('returns runtime results and releases failed or completed build processes', async () => {
	const f = fixture();
	const requirements = { effectIds: ['fill'], requiresExpressions: false, requiresCustomShaderEffects: true };
	const first = f.invoke('build-portable-custom-node-graph-effect', 'first', requirements);
	assert.throws(() => f.invoke('build-portable-custom-node-graph-effect', 'second', requirements), /already running/);
	const child = f.children[0];
	child.emit('spawn');
	assert.deepEqual(child.messages, [requirements]);
	child.emit('message', { runtime: { elementSource: 'element', workerSource: 'worker' } });
	assert.deepEqual(await first, { elementSource: 'element', workerSource: 'worker' });
	assert.equal(child.kills, 1);
	assert.equal(f.sender.listenerCount('destroyed'), 0);
	const failed = f.invoke('build-portable-custom-node-graph-effect', 'failed', requirements);
	f.children[1].emit('exit', 1);
	await assert.rejects(failed, /exited/);
	const rejected = f.invoke('build-portable-custom-node-graph-effect', 'rejected', requirements);
	f.children[2].emit('message', { error: 'Unknown effect' });
	await assert.rejects(rejected, /Unknown effect/);
});

// 【起動前のキャンセルとウィンドウ破棄でも子プロセスを残さない】
// キャンセル直後の別要求を古いIDで中断せず、遅れて起動したプロセスも終了させる。
test('cancels only the matching request including before process startup', async () => {
	const f = fixture();
	const pending = f.invoke('build-portable-custom-node-graph-effect', 'first', {});
	f.invoke('cancel-portable-custom-node-graph-effect', 'stale');
	assert.equal(f.children[0].kills, 0);
	f.invoke('cancel-portable-custom-node-graph-effect', 'first');
	await assert.rejects(pending, /canceled/);
	f.children[0].emit('spawn');
	assert.equal(f.children[0].kills, 2);
	assert.deepEqual(f.children[0].messages, []);
	const next = f.invoke('build-portable-custom-node-graph-effect', 'next', {});
	f.invoke('cancel-portable-custom-node-graph-effect', 'first');
	f.sender.emit('destroyed');
	await assert.rejects(next, /closed/);
	for (const handler of f.handlers.values()) assert.throws(() => handler({}, 'unknown', {}), /Untrusted/);
});
