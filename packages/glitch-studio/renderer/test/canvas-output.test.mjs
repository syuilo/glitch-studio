import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCanvasOutputConfigurator, createSrgbCanvasOutputSettings } from '../src/canvas-output.ts';

// 【SDRの出力設定は形式を明示でき、プレビュー設定から独立した不変値にする】
// 書き出しが将来のプレビュー用float設定を暗黙に引き継いだり、構成後に設定を書き換えて
// Canvasとpipelineの形式がずれたりすることを防ぐ。現在有効な出力規約だけを受け付ける。
test('creates immutable sRGB outputs with explicitly selected 8-bit formats', () => {
	for (const format of ['rgba8unorm', 'bgra8unorm']) {
		const output = createSrgbCanvasOutputSettings(format);
		assert.deepEqual(output, { format, colorSpace: 'srgb' });
		assert.equal(Object.isFrozen(output), true);
	}
	assert.throws(() => createSrgbCanvasOutputSettings('rgba16float'), /Unsupported 8-bit sRGB canvas format/);
});

// 【同じCanvas構成を再適用せず、透明出力を切り替えたときだけ再構成する】
// configureのたびに表示画像や未完了の読み戻しが失われるため、通常の設定同期では呼ばない。
// GPUの推奨形式を内部で選び直さず、呼び出し元がpipelineへ渡す設定をそのまま使う。
test('configures the supplied output only when its alpha mode changes', t => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'GPUTextureUsage');
	Object.defineProperty(globalThis, 'GPUTextureUsage', { configurable: true, value: { RENDER_ATTACHMENT: 16 } });
	t.after(() => {
		if (previous == null) delete globalThis.GPUTextureUsage;
		else Object.defineProperty(globalThis, 'GPUTextureUsage', previous);
	});
	const configurations = [];
	const device = {};
	const output = createSrgbCanvasOutputSettings('rgba8unorm');
	const configure = createCanvasOutputConfigurator(device, { configure: value => configurations.push(value) }, output);
	configure('opaque'); configure('opaque'); configure('premultiplied'); configure('premultiplied'); configure('opaque');
	assert.deepEqual(configurations, ['opaque', 'premultiplied', 'opaque'].map(alphaMode => ({
		device, format: 'rgba8unorm', colorSpace: 'srgb', alphaMode, usage: 16,
	})));
});
