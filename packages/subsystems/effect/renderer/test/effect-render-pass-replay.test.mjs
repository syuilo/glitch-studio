import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EffectRenderPassReplay } from '../src/effect-render-pass-replay.ts';
import { createEffectRenderDevice, getEffectRenderViewLayout } from '../src/effect-render-device.ts';

function recordingTarget(commands) {
	return new Proxy({}, { get: (_, method) => (...args) => commands.push({ method, args }) });
}

function setup() {
	const bundles = [];
	const device = createEffectRenderDevice({
		createTexture: descriptor => ({ ...descriptor, width: 17, height: 13, sampleCount: descriptor.sampleCount ?? 1, createView: () => ({}) }),
		createRenderBundleEncoder(descriptor) {
			const commands = [];
			const bundle = { descriptor, commands };
			bundles.push(bundle);
			return new Proxy(recordingTarget(commands), { get: (target, method) => method === 'finish' ? () => bundle : target[method] });
		},
	});
	const view = device.createTexture({ format: 'rgba16float' }).createView();
	const descriptor = { colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] };
	const draw = (replay, tile = { x: 0, y: 0, width: 8, height: 8 }) => {
		const commands = [];
		replay.replay(recordingTarget(commands), tile);
		return commands;
	};
	return { device, bundles, view, descriptor, draw };
}

// 【二回目からBundleを共有し、一枚だけの描画に生成費用を追加しない】
// フレームをまたいだbind groupのキャッシュは、動画などのリソース寿命を誤る。
// 一回の描画内だけで共有し、元のGPUリソースとdynamic offsetをそのまま登録する。
test('lazily shares one bundle within a render execution and rebuilds for new executions', () => {
	const g = setup();
	const pipeline = {}, group = {}, buffer = {};
	const commands = [{ method: 'setPipeline', args: [pipeline] }, { method: 'setBindGroup', args: [0, group, [256]] },
		{ method: 'setVertexBuffer', args: [0, buffer] }, { method: 'draw', args: [3] }];
	const replay = new EffectRenderPassReplay(g.device, g.descriptor, commands);
	assert.ok(g.draw(replay).some(command => command.method === 'draw'));
	assert.equal(g.bundles.length, 0);
	const second = g.draw(replay);
	const third = g.draw(replay, { x: 8, y: 0, width: 8, height: 8 });
	assert.equal(g.bundles.length, 1);
	assert.deepEqual(g.bundles[0].commands, commands);
	assert.equal(second.find(command => command.method === 'executeBundles').args[0][0], g.bundles[0]);
	assert.equal(third.find(command => command.method === 'executeBundles').args[0][0], g.bundles[0]);
	assert.deepEqual(third[0].args, [8, 0, 8, 8]);
	assert.equal(g.bundles[0].commands[0].args[0], pipeline);
	const next = new EffectRenderPassReplay(g.device, g.descriptor, commands);
	g.draw(next); g.draw(next);
	assert.equal(g.bundles.length, 2);
});

// 【パスの動的状態はBundleの外で設定し、Scissorをタイルに交差させる】
// BundleはViewportやScissorを持てず、Draw間の状態変更を前方へ移すと画像が変わる。
// 対応できない途中変更・既存Bundle・Queryは、コマンド順を保つ元の再生へ戻す。
test('keeps prefix render state outside bundles and falls back for interleaved state and unsupported commands', () => {
	const g = setup();
	const prefix = [{ method: 'setPipeline', args: [{}] }, { method: 'setViewport', args: [1, 2, 12, 10, 0, 1] },
		{ method: 'setScissorRect', args: [2, 1, 10, 7] }, { method: 'setBlendConstant', args: [{ r: 0.25, g: 0.5, b: 1, a: 1 }] },
		{ method: 'setStencilReference', args: [3] }];
	const replay = new EffectRenderPassReplay(g.device, g.descriptor, [...prefix, { method: 'draw', args: [3] }]);
	g.draw(replay);
	const commands = g.draw(replay);
	assert.deepEqual(commands.filter(command => command.method === 'setScissorRect').map(command => command.args), [[0, 0, 8, 8], [2, 1, 6, 7]]);
	assert.deepEqual(commands.filter(command => ['setViewport', 'setBlendConstant', 'setStencilReference'].includes(command.method)), prefix.filter(command => command.method !== 'setPipeline' && command.method !== 'setScissorRect'));
	assert.deepEqual(g.bundles[0].commands.map(command => command.method), ['setPipeline', 'draw']);
	for (const method of ['setScissorRect', 'setViewport', 'setBlendConstant', 'setStencilReference', 'executeBundles', 'beginOcclusionQuery']) {
		const original = [...prefix, { method: 'draw', args: [3] }, { method, args: method === 'setScissorRect' ? [0, 0, 4, 4] : [1] }, { method: 'draw', args: [3] }];
		const fallback = new EffectRenderPassReplay(g.device, g.descriptor, original);
		g.draw(fallback);
		assert.deepEqual(g.draw(fallback).map(command => command.method), ['setScissorRect', ...original.map(command => command.method), 'end']);
	}
	assert.equal(g.bundles.length, 1);
});

// 【Bundleの互換性にView形式・空の色attachment・MSAA・depthの読み取り専用状態を含める】
// テクスチャ本体の形式だけでは、View形式の上書きや深度のみのパスが不正なBundleになる。
test('matches bundle layouts to texture views, sparse attachments, multisampling and read-only depth', () => {
	const g = setup();
	const color = g.device.createTexture({ format: 'rgba8unorm', sampleCount: 4 }).createView({ format: 'rgba8unorm-srgb', baseMipLevel: 1 });
	const depth = g.device.createTexture({ format: 'depth24plus-stencil8', sampleCount: 4 }).createView();
	assert.deepEqual(getEffectRenderViewLayout(color), { format: 'rgba8unorm-srgb', sampleCount: 4 });
	for (const colorAttachments of [[{ view: color, loadOp: 'clear', storeOp: 'store' }, null], []]) {
		const replay = new EffectRenderPassReplay(g.device, { colorAttachments,
			depthStencilAttachment: { view: depth, depthReadOnly: true, stencilReadOnly: true } }, [{ method: 'draw', args: [3] }]);
		g.draw(replay); g.draw(replay);
		assert.deepEqual(g.bundles.at(-1).descriptor, { colorFormats: colorAttachments.length === 0 ? [] : ['rgba8unorm-srgb', null],
			depthStencilFormat: 'depth24plus-stencil8', sampleCount: 4, depthReadOnly: true, stencilReadOnly: true });
	}
});

// 【先頭・中間・末尾のdescriptorを再利用し、clear・resolve・破棄の境界を保つ】
// タイルごとの配列再生成を避けても、中間タイルでresolveやdiscardすると結果が失われる。
test('reuses descriptors while preserving first clears, final resolves and depth stores', () => {
	const g = setup();
	const resolveTarget = {};
	const original = { colorAttachments: [{ view: g.view, resolveTarget, loadOp: 'clear', storeOp: 'discard' }],
		depthStencilAttachment: { view: {}, depthLoadOp: 'clear', depthStoreOp: 'discard', depthClearValue: 1,
			stencilLoadOp: 'clear', stencilStoreOp: 'discard', stencilClearValue: 0 } };
	const replay = new EffectRenderPassReplay(g.device, original, []);
	for (const [first, last] of [[true, true], [true, false], [false, false], [false, true]]) {
		const descriptor = replay.descriptor(first, last);
		assert.equal(replay.descriptor(first, last), descriptor);
		assert.equal(descriptor.colorAttachments[0].loadOp, first ? 'clear' : 'load');
		assert.equal(descriptor.depthStencilAttachment.depthLoadOp, first ? 'clear' : 'load');
		assert.equal(descriptor.depthStencilAttachment.stencilLoadOp, first ? 'clear' : 'load');
		assert.equal(descriptor.colorAttachments[0].storeOp, last ? 'discard' : 'store');
		assert.equal(descriptor.depthStencilAttachment.depthStoreOp, last ? 'discard' : 'store');
		assert.equal(descriptor.depthStencilAttachment.stencilStoreOp, last ? 'discard' : 'store');
		assert.equal(descriptor.colorAttachments[0].resolveTarget, last ? resolveTarget : undefined);
	}
	const probe = replay.descriptor(true, false, true);
	assert.equal(probe.colorAttachments[0].resolveTarget, undefined);
	assert.equal(probe.colorAttachments[0].storeOp, 'store');
	assert.equal(replay.descriptor(true, false, true), probe);
	assert.equal(original.colorAttachments[0].storeOp, 'discard');
});
