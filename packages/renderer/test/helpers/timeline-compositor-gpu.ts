import { createTimelineCompositor } from '../../src/timeline-compositor.ts';
import type { TimelineCompositingSettings } from '../../src/timeline-compositing-parameters.ts';
import type { NodeOutput } from '../../src/node-output.ts';
import { colorBlendModes } from '../../../shared/src/color-blend.ts';

// 実際の合成シェーダーを実行し、透明背景・変形後の空白・長方形での回転を画素で確認する。
export async function checkTimelineCompositor(device: GPUDevice, vertex: GPUShaderModule, read: (output: GPUTexture) => Promise<number[]>) {
	const resolution = { width: 8, height: 4 };
	const compositor = createTimelineCompositor({ device, vertex, resolution, format: 'rgba8unorm' });
	const textures: GPUTexture[] = [];
	const completed: string[] = [];
	const defaults: TimelineCompositingSettings = { blendMode: 0, opacity: 1, translation: [0, 0], scale: [1, 1], rotation: 0 };
	const uniform = (value: number[]): NodeOutput => ({ kind: 'uniform', value });
	const blue = uniform([0, 0, 1, 1]);
	const red = uniform([1, 0, 0, 1]);
	const transparent = uniform([0, 0, 0, 0]);
	const texture = (width: number, height: number, values: number[], format: 'rgba8unorm' | 'rgba32float' = 'rgba8unorm'): NodeOutput => {
		const texture = device.createTexture({ size: [width, height], format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		textures.push(texture);
		const data = format === 'rgba32float' ? new Float32Array(values) : new Uint8Array(values);
		device.queue.writeTexture({ texture }, data, { bytesPerRow: data.byteLength / height }, [width, height]);
		return { kind: 'texture', texture };
	};
	const pixels = (pixel: (x: number, y: number) => number[]) => Array.from({ length: 4 }, (_, y) => Array.from({ length: 8 }, (_, x) => pixel(x, y))).flat(2);
	const solid = (pixel: number[]) => pixels(() => pixel);
	async function check(name: string, background: NodeOutput, source: NodeOutput, settings: Partial<TimelineCompositingSettings>, expected: number[]) {
		const encoder = device.createCommandEncoder();
		const output = compositor.render(encoder, background, source, { ...defaults, ...settings });
		device.queue.submit([encoder.finish()]);
		if (output.kind !== 'texture') throw new Error(`${name}: expected a rendered texture`);
		const actual = await read(output.texture);
		if (actual.length !== expected.length || actual.some((value, i) => Math.abs(value - expected[i]) > 2)) {
			throw new Error(`${name}: ${actual} != ${expected}`);
		}
		completed.push(name);
	}
	try {
		// 半透明の素材にopacityを掛けても、RGBへalphaを二重乗算しない。
		await check('timeline normal opacity preserves premultiplied colors', blue, uniform([0.5, 0, 0, 0.5]), { opacity: 0.5 }, solid([64, 0, 191, 255]));
		await check('timeline normal combines two translucent layers', uniform([0, 0, 0.5, 0.5]), uniform([0.5, 0, 0, 0.5]), { opacity: 0.5 }, solid([64, 0, 96, 159]));
		await check('timeline transparent source leaves background intact', blue, transparent, {}, solid([0, 0, 255, 255]));
		await check('timeline multiply blends straight colors', uniform([0.8, 0.4, 0.2, 1]), uniform([0.5, 1, 0.5, 1]), { blendMode: 3 }, solid([102, 102, 26, 255]));
		// 置き換えでは素材のalpha=0も採用し、opacityは背景からの補間量となる。
		await check('timeline replace interpolates transparent output', blue, transparent, { blendMode: 19, opacity: 0.5 }, solid([0, 0, 128, 128]));
		await check('timeline translated source keeps background stationary', blue, red, { translation: [1, 0] }, pixels(x => x < 4 ? [0, 0, 255, 255] : [255, 0, 0, 255]));
		await check('timeline replace clears translated margins', blue, red, { blendMode: 19, translation: [1, 0] }, pixels(x => x < 4 ? [0, 0, 0, 0] : [255, 0, 0, 255]));
		await check('timeline replace opacity includes translated margins', blue, red, { blendMode: 19, translation: [1, 0], opacity: 0.5 }, pixels(x => x < 4 ? [0, 0, 128, 128] : [128, 0, 128, 255]));
		// 正のYは上方向。上下反転の取り違えを検出する。
		await check('timeline positive y moves source upward', blue, red, { translation: [0, 1] }, pixels((_, y) => y < 2 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
		await check('timeline scale shrinks around canvas center', blue, red, { scale: [0.5, 0.5] }, pixels((x, y) => x >= 2 && x < 6 && y >= 1 && y < 3 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
		await check('timeline rotation respects rectangular aspect ratio', blue, red, { rotation: 0.5 }, pixels(x => x >= 2 && x < 6 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
		await check('timeline zero scale produces transparent source', blue, red, { scale: [0, 1] }, solid([0, 0, 255, 255]));
		await check('timeline replace with zero scale clears background', blue, red, { blendMode: 19, scale: [0, 1] }, solid([0, 0, 0, 0]));
		// テクスチャ入力の左右反転と、uniform/texture切り替え時のpipeline更新を確認する。
		const striped = texture(8, 4, pixels(x => x < 4 ? [255, 0, 0, 255] : [0, 255, 0, 255]));
		await check('timeline negative scale flips texture source', transparent, striped, { scale: [-1, 1] }, pixels(x => x < 4 ? [0, 255, 0, 255] : [255, 0, 0, 255]));
		// 異なる比率の背景でも、その背景自身のサイズを使ってcoverする。
		const wideBackground = texture(16, 4, Array.from({ length: 4 }, () => Array.from({ length: 16 }, (_, x) => x >= 4 && x < 12 ? [0, 255, 0, 255] : [255, 0, 0, 255])).flat(2));
		await check('timeline fits background using its own dimensions', wideBackground, transparent, {}, solid([0, 255, 0, 255]));
		await check('timeline fits source using its own dimensions', transparent, wideBackground, {}, solid([0, 255, 0, 255]));
		if (device.features.has('float32-filterable')) {
			const floatSource = texture(8, 4, solid([0.5, 0, 0, 0.5]), 'rgba32float');
			await check('timeline filters float32 source without double premultiplication', blue, floatSource, { opacity: 0.5 }, solid([64, 0, 191, 255]));
		}
		// 全モードの分岐が実行可能であり、不透明な入力から透明度が失われないことを確認する。
		for (const [name, blendMode] of Object.entries(colorBlendModes)) {
			if (name === 'none') continue;
			const encoder = device.createCommandEncoder();
			const output = compositor.render(encoder, blue, red, { ...defaults, blendMode });
			device.queue.submit([encoder.finish()]);
			if (output.kind !== 'texture') throw new Error('Expected texture');
			const actual = await read(output.texture);
			if (actual.some((v, i) => i % 4 === 3 && v !== 255)) throw new Error(`Invalid alpha for ${name}`);
			completed.push(`timeline blend mode ${name}`);
		}
		return completed;
	} finally {
		compositor.dispose();
		for (const texture of textures) texture.destroy();
	}
}
