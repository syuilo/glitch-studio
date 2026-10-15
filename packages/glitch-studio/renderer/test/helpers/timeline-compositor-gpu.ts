import { createTimelineCompositor } from '@gs/subsystems_timeline_renderer/timeline-compositor.ts';
import type { TimelineCompositingSettings } from '@gs/subsystems_timeline_renderer/timeline-compositing-parameters.ts';
import type { UniformOrTexture } from '@gs/shared/gpu/uniform-or-texture.ts';
import { colorBlendModes } from '@gs/shared/color-blend.ts';

// 実際の合成シェーダーを実行し、透明背景・変形後の空白・長方形での回転を画素で確認する。
export async function checkTimelineCompositor(device: GPUDevice, vertex: GPUShaderModule, read: (output: GPUTexture) => Promise<number[]>) {
	const resolution = { width: 8, height: 4 };
	const compositor = createTimelineCompositor({ device, vertex, resolution, format: 'rgba8unorm' });
	const textures: GPUTexture[] = [];
	const completed: string[] = [];
	const defaults: TimelineCompositingSettings = { mask: null, coordinateSpace: 'world', depth: 0, clipToFrame: false, blendMode: 0, opacity: 1, fitMode: 'contain', position: [0, 0], origin: [0, 0], scale: [1, 1], rotation: 0 };
	const uniform = (value: number[]): UniformOrTexture => ({ kind: 'uniform', value });
	const blue = uniform([0, 0, 1, 1]);
	const red = uniform([1, 0, 0, 1]);
	const transparent = uniform([0, 0, 0, 0]);
	const texture = (width: number, height: number, values: number[], format: 'rgba8unorm' | 'rgba32float' = 'rgba8unorm'): UniformOrTexture => {
		const texture = device.createTexture({ size: [width, height], format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		textures.push(texture);
		const data = format === 'rgba32float' ? new Float32Array(values) : new Uint8Array(values);
		device.queue.writeTexture({ texture }, data, { bytesPerRow: data.byteLength / height }, [width, height]);
		return { kind: 'texture', texture };
	};
	const pixels = (pixel: (x: number, y: number) => number[]) => Array.from({ length: 4 }, (_, y) => Array.from({ length: 8 }, (_, x) => pixel(x, y))).flat(2);
	const solid = (pixel: number[]) => pixels(() => pixel);

	async function check(name: string, background: UniformOrTexture, source: UniformOrTexture, settings: Partial<TimelineCompositingSettings>, expected: number[]) {
		const encoder = device.createCommandEncoder();
		const output = compositor.render(encoder, background, source, { ...defaults, ...settings });
		device.queue.submit([encoder.finish()]);
		const actual = output.kind === 'texture' ? await read(output.texture) : solid(output.value.map(value => Math.round(value * 255)));
		if (actual.length !== expected.length || actual.some((value, i) => Math.abs(value - expected[i]) > 2)) {
			throw new Error(`${name}: ${actual} != ${expected}`);
		}
		completed.push(name);
	}

	try {
		const alphaMask = { channel: 'alpha' as const, inverted: false };
		const luminanceMask = { channel: 'luminance' as const, inverted: false };
		// 【Alphaマスクは素材の色を描かず、下層のpremultiplied RGBAをまとめて減衰させる】
		// alphaだけを書き換えると透明な輪郭に元のRGBが残る。半透明の下層でも検証する。
		await check('timeline alpha mask attenuates premultiplied background', uniform([0.2, 0.1, 0.05, 0.5]), uniform([0.3, 0.1, 0, 0.5]), { mask: alphaMask }, solid([26, 13, 6, 64]));
		// 【輝度マスクは色と素材自身の透明度を一度だけ反映する】
		// Alphaとの取り違えと、premultiplied RGBへのalpha二重乗算を実画素で検出する。
		await check('timeline luminance mask reads colored source', blue, red, { mask: luminanceMask }, solid([0, 0, 54, 54]));
		await check('timeline luminance mask counts source alpha once', blue, uniform([0.5, 0.5, 0.5, 0.5]), { mask: luminanceMask }, solid([0, 0, 128, 128]));
		// 【強度0では下層を保持し、中間値はマスク適用前後を補間する】
		// 透明な素材へopacityを掛ける実装では、0にしても下層が消えてしまう。
		await check('timeline zero mask strength preserves background', blue, transparent, { mask: alphaMask, opacity: 0 }, solid([0, 0, 255, 255]));
		await check('timeline partial mask strength interpolates coverage', blue, transparent, { mask: alphaMask, opacity: 0.25 }, solid([0, 0, 191, 191]));
		// 【マスク時は保存済みのNone・Replaceを含むブレンド設定を使わない】
		// 通常描画へ戻すための設定を保持していても、マスクがスキップ・素材へ置換されてはならない。
		await check('timeline mask ignores none blend mode', blue, transparent, { mask: alphaMask, blendMode: 10 }, solid([0, 0, 0, 0]));
		await check('timeline mask ignores replace fast path', blue, red, { mask: alphaMask, blendMode: 19 }, solid([0, 0, 255, 255]));
		// 【配置後の素材範囲外は0とし、反転はその範囲外にも作用する】
		// 素材の矩形だけ描画すると、通常マスクの外側が残ったり反転の外側まで消えてしまう。
		await check('timeline mask uses transformed source bounds', blue, red, { mask: alphaMask, position: [1, 0] }, pixels(x => x < 4 ? [0, 0, 0, 0] : [0, 0, 255, 255]));
		await check('timeline inverted mask retains outside source bounds', blue, red, { mask: { ...alphaMask, inverted: true }, position: [1, 0] }, pixels(x => x < 4 ? [0, 0, 255, 255] : [0, 0, 0, 0]));
		// 【倍率0は区間外ではなく、有効な透明マスクとして扱う】
		// 透明な生成結果・素材が画面外へ出た場合も同じ被覆率の規則で処理できる。
		await check('timeline zero scale mask clears background', blue, red, { mask: alphaMask, scale: [0, 1] }, solid([0, 0, 0, 0]));
		// 【画像テクスチャのAlphaも、定数のAlphaと同じ規則で読み取る】
		// 動画・画像のマスクを使う経路で、型別のpipeline切り替えと補間を検証する。
		const maskTexture = texture(8, 4, pixels(x => x < 4 ? [255, 0, 0, 255] : [0, 0, 0, 0]));
		await check('timeline texture mask reads alpha without drawing its color', blue, maskTexture, { mask: alphaMask }, pixels(x => x < 4 ? [0, 0, 255, 255] : [0, 0, 0, 0]));
		// 半透明の素材にopacityを掛けても、RGBへalphaを二重乗算しない。
		await check('timeline normal opacity preserves premultiplied colors', blue, uniform([0.5, 0, 0, 0.5]), { opacity: 0.5 }, solid([64, 0, 191, 255]));
		await check('timeline normal combines two translucent layers', uniform([0, 0, 0.5, 0.5]), uniform([0.5, 0, 0, 0.5]), { opacity: 0.5 }, solid([64, 0, 96, 159]));
		await check('timeline transparent source leaves background intact', blue, transparent, {}, solid([0, 0, 255, 255]));
		await check('timeline multiply blends straight colors', uniform([0.8, 0.4, 0.2, 1]), uniform([0.5, 1, 0.5, 1]), { blendMode: 3 }, solid([102, 102, 26, 255]));
		// 置き換えでは素材のalpha=0も採用し、opacityは背景からの補間量となる。
		await check('timeline replace interpolates transparent output', blue, transparent, { blendMode: 19, opacity: 0.5 }, solid([0, 0, 128, 128]));
		await check('timeline translated source keeps background stationary', blue, red, { position: [1, 0] }, pixels(x => x < 4 ? [0, 0, 255, 255] : [255, 0, 0, 255]));
		await check('timeline replace clears translated margins', blue, red, { blendMode: 19, position: [1, 0] }, pixels(x => x < 4 ? [0, 0, 0, 0] : [255, 0, 0, 255]));
		await check('timeline replace opacity includes translated margins', blue, red, { blendMode: 19, position: [1, 0], opacity: 0.5 }, pixels(x => x < 4 ? [0, 0, 128, 128] : [128, 0, 128, 255]));
		// 正のYは上方向。上下反転の取り違えを検出する。
		await check('timeline positive y moves source upward', blue, red, { position: [0, 1] }, pixels((_, y) => y < 2 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
		await check('timeline scale shrinks around canvas center', blue, red, { scale: [0.5, 0.5] }, pixels((x, y) => x >= 2 && x < 6 && y >= 1 && y < 3 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
		await check('timeline rotation respects rectangular aspect ratio', blue, red, { rotation: 0.5 }, pixels(x => x >= 2 && x < 6 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
		// 【素材の右端を画面中央に配置する】
		// 定数には画面サイズの素材枠を与える。originだけを変えても配置が動くことを確認する。
		await check('timeline anchors the right edge of a uniform source at the center', blue, red, { origin: [1, 0] }, pixels(x => x < 4 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
		// 【支点の配置先を維持して拡縮する】
		// 拡縮を戻した後にoriginへ戻さないと、倍率に応じて右端が画面中央からずれる。
		await check('timeline scales around the positioned source anchor', blue, red, { origin: [1, 0], scale: [0.5, 0.5] }, pixels((x, y) => x < 4 && y >= 1 && y < 3 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
		// 【長方形の素材を端の支点で回転する】
		// 右端を中央に固定して時計回り90度回すと、素材は支点の上側へ伸びる。
		await check('timeline rotates around the positioned source anchor', blue, red, { origin: [1, 0], rotation: 0.5 }, pixels((x, y) => x >= 2 && x < 6 && y < 2 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
		// 【fit後も画面端ではなく素材端を支点にする】
		// coverでは画面外の端、containでは余白を除いた素材端を中央へ配置する。
		const wideRed = texture(16, 4, Array.from({ length: 64 }, () => [255, 0, 0, 255]).flat());
		await check('timeline anchors the covered source edge at the center', blue, wideRed, { origin: [1, 0], fitMode: 'cover' }, pixels(x => x < 4 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
		await check('timeline anchors the contained source edge at the center', blue, wideRed, { origin: [1, 0], fitMode: 'contain' }, pixels((x, y) => x < 4 && y >= 1 && y < 3 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
		await check('timeline zero scale produces transparent source', blue, red, { scale: [0, 1] }, solid([0, 0, 255, 255]));
		await check('timeline replace with zero scale clears background', blue, red, { blendMode: 19, scale: [0, 1] }, solid([0, 0, 0, 0]));
		// テクスチャ入力の左右反転と、uniform/texture切り替え時のpipeline更新を確認する。
		const striped = texture(8, 4, pixels(x => x < 4 ? [255, 0, 0, 255] : [0, 255, 0, 255]));
		await check('timeline negative scale flips texture source', transparent, striped, { scale: [-1, 1] }, pixels(x => x < 4 ? [0, 255, 0, 255] : [255, 0, 0, 255]));
		// 【背景は配置済みのScene画像として読み、素材の比率で再度Coverしない】
		// 無変形Replaceは素材を借用するため、物理テクスチャの比率がSceneと異なる場合もある。
		const wideBackground = texture(16, 4, Array.from({ length: 4 }, () => Array.from({ length: 16 }, (_, x) => x >= 4 && x < 12 ? [0, 255, 0, 255] : [255, 0, 0, 255])).flat(2));
		await check('timeline preserves the full placed background', wideBackground, transparent, {}, pixels(x => x >= 2 && x < 6 ? [0, 255, 0, 255] : [255, 0, 0, 255]));
		await check('timeline fits source using its own dimensions', transparent, wideBackground, { fitMode: 'cover' }, solid([0, 255, 0, 255]));
		if (device.features.has('float32-filterable')) {
			const floatSource = texture(8, 4, solid([0.5, 0, 0, 0.5]), 'rgba32float');
			await check('timeline filters float32 source without double premultiplication', blue, floatSource, { opacity: 0.5 }, solid([64, 0, 191, 255]));
		}
		// 全モードの分岐が実行可能であり、不透明な入力から透明度が失われないことを確認する。
		for (const [name, blendMode] of Object.entries(colorBlendModes)) {
			// Replaceは上の専用ケースで検証する。無変形ではuniformのまま返る。
			if (name === 'none' || name === 'replace') continue;
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
