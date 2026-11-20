import { createSolidTimelineImage } from './solid-timeline-image.ts';
import { createTimelineCompositor } from '@gs/subsystems_timeline_renderer/timeline-compositor.ts';
import type { TimelineCompositingSettings } from '@gs/subsystems_timeline_renderer/timeline-compositing-parameters.ts';
import type { TimelineRenderSpace } from '@gs/subsystems_timeline_shared/spatial.ts';
import type { TimelineImage } from '@gs/subsystems_timeline_renderer/timeline-image.ts';
import { colorBlendModes } from '@gs/shared/color-blend.ts';

// 実際の合成シェーダーを実行し、透明背景・変形後の空白・長方形での回転を画素で確認する。
export async function checkTimelineCompositor(device: GPUDevice, vertex: GPUShaderModule, read: (output: GPUTexture) => Promise<number[]>) {
	const resolution = { width: 8, height: 4 };
	const compositor = createTimelineCompositor({
		device,
		vertex,
		resolution,
	});
	const textures: GPUTexture[] = [];
	const completed: string[] = [];
	const defaults: TimelineCompositingSettings = {
		transformTarget: 'image',
		mask: null,
		layerMask: null,
		coordinateSpace: 'world',
		depth: 0,
		clipToFrame: false,
		blendMode: 0,
		opacity: 1,
		fitMode: 'contain',
		position: [0, 0],
		origin: [0, 0],
		scale: [1, 1],
		rotation: 0,
	};
	const solidImage = (color: GPUColor) => {
		const image = createSolidTimelineImage(device, resolution, color);
		textures.push(image.texture);
		return image;
	};
	const blue = solidImage([0, 0, 1, 1]);
	const red = solidImage([1, 0, 0, 1]);
	const transparent = solidImage([0, 0, 0, 0]);
	const texture = (width: number, height: number, values: number[], format: 'rgba8unorm' | 'rgba32float' = 'rgba8unorm'): TimelineImage => {
		const texture = device.createTexture({ size: [width, height], format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		textures.push(texture);
		const data = format === 'rgba32float' ? new Float32Array(values) : new Uint8Array(values);
		device.queue.writeTexture({ texture }, data, { bytesPerRow: data.byteLength / height }, [width, height]);
		return { kind: 'texture', texture };
	};
	const pixels = (pixel: (x: number, y: number) => number[]) => Array.from({ length: 4 }, (_, y) => Array.from({ length: 8 }, (_, x) => pixel(x, y))).flat(2);
	const solid = (pixel: number[]) => pixels(() => pixel);

	async function check(name: string, background: TimelineImage, source: TimelineImage, settings: Partial<TimelineCompositingSettings>, expected: number[], space?: TimelineRenderSpace, layerMaskImage: TimelineImage | null = null) {
		const encoder = device.createCommandEncoder();
		const output = compositor.render(encoder, background, source, { ...defaults, ...settings }, space, false, undefined, layerMaskImage);
		device.queue.submit([encoder.finish()]);
		const actual = await read(output.texture);
		if (actual.length !== expected.length || actual.some((value, i) => Math.abs(value - expected[i]) > 2)) {
			throw new Error(`${name}: ${actual} != ${expected}`);
		}
		completed.push(name);
	}

	try {
		const alphaMask = { channel: 'alpha' as const, inverted: false };
		const luminanceMask = { channel: 'luminance' as const, inverted: false };
		const layerMask = { sourceLayerId: 'mask-source', ...alphaMask };
		const leftMask = texture(8, 4, pixels(x => x < 4 ? [255, 255, 255, 255] : [0, 0, 0, 0]));
		// 【参照マスクは対象だけを減衰させ、premultiplied RGBとalphaを揃える】
		// 下層全体を切り抜く既存マスクとの取り違えと、opacity・alphaの二重乗算を画素で検出する。
		await check('timeline referenced alpha mask retains the background', blue, red, { layerMask }, solid([128, 0, 128, 255]), undefined, solidImage([0, 1, 0, 0.5]));
		await check('timeline referenced mask preserves premultiplied translucency', transparent, solidImage([0.5, 0, 0, 0.5]), { layerMask, opacity: 0.5 }, solid([32, 0, 0, 32]), undefined, solidImage([0.5, 0.5, 0.5, 0.5]));
		await check('timeline referenced luminance counts alpha once', blue, red, { layerMask: { ...layerMask, channel: 'luminance' } }, solid([128, 0, 128, 255]), undefined, solidImage([0.5, 0.5, 0.5, 0.5]));
		await check('timeline referenced luminance reads working RGB weights', blue, red, { layerMask: { ...layerMask, channel: 'luminance' } }, solid([54, 0, 201, 255]), undefined, red);
		// 【Replaceでは透明な対象もマスク内だけ背景を置換する】
		// 素材へマスクを乗算するだけでは、マスク外まで透明黒で置き換えてしまう。
		await check('timeline referenced mask limits transparent replacement', blue, transparent, { layerMask, blendMode: 19 }, pixels(x => x < 4 ? [0, 0, 0, 0] : [0, 0, 255, 255]), undefined, leftMask);
		await check('timeline referenced mask disables replace borrowing', blue, red, { layerMask, blendMode: 19 }, pixels(x => x < 4 ? [255, 0, 0, 255] : [0, 0, 255, 255]), undefined, leftMask);
		await check('timeline inverted referenced mask retains its inverse area', blue, red, { layerMask: { ...layerMask, inverted: true } }, pixels(x => x < 4 ? [0, 0, 255, 255] : [255, 0, 0, 255]), undefined, leftMask);
		// 【マスク元の配置を対象の変形へ追従させず、描画済みの座標範囲で読む】
		// テクスチャ寸法から再Fitしたり対象の逆変換を掛けると、別々に動く2枚の位置がずれる。
		await check('timeline referenced mask stays independent from target placement', blue, red, { layerMask, position: [0.5, 0] }, solid([0, 0, 255, 255]), undefined, leftMask);
		await check('timeline referenced mask honors placed image bounds', blue, red, { layerMask }, pixels(x => x < 4 ? [255, 0, 0, 255] : [0, 0, 255, 255]), undefined,
			{
				...solidImage([1, 1, 1, 1]),
				region: {
					bounds: {
						left: -1,
						bottom: -1,
						right: 0,
						top: 1,
					},
					frameSize: resolution,
				},
			});
		await check('timeline missing referenced mask is transparent black', blue, red, { layerMask }, solid([0, 0, 255, 255]));
		await check('timeline inverted missing referenced mask passes the target', blue, red, { layerMask: { ...layerMask, inverted: true } }, solid([255, 0, 0, 255]));
		// 【参照マスクは範囲モードと既存の下層マスクの作用範囲にも掛かる】
		// 共通の被覆率で扱わないと、特定モードだけマスク外の背景を変更する。
		await check('timeline referenced mask intersects application regions', blue, red, {
			layerMask,
			transformTarget: 'region',
			position: [0.25, 0],
			scale: [0.5, 1],
		}, solid([0, 0, 255, 255]), undefined, leftMask);
		await check('timeline referenced mask limits lower-layer masking', blue, transparent, { layerMask, mask: alphaMask }, pixels(x => x < 4 ? [0, 0, 0, 0] : [0, 0, 255, 255]), undefined, leftMask);
		// 【Alphaマスクは素材の色を描かず、下層のpremultiplied RGBAをまとめて減衰させる】
		// alphaだけを書き換えると透明な輪郭に元のRGBが残る。半透明の下層でも検証する。
		await check('timeline alpha mask attenuates premultiplied background', solidImage([0.2, 0.1, 0.05, 0.5]), solidImage([0.3, 0.1, 0, 0.5]), { mask: alphaMask }, solid([26, 13, 6, 64]));
		// 【輝度マスクは色と素材自身の透明度を一度だけ反映する】
		// Alphaとの取り違えと、premultiplied RGBへのalpha二重乗算を実画素で検出する。
		await check('timeline luminance mask reads colored source', blue, red, { mask: luminanceMask }, solid([0, 0, 54, 54]));
		await check('timeline luminance mask counts source alpha once', blue, solidImage([0.5, 0.5, 0.5, 0.5]), { mask: luminanceMask }, solid([0, 0, 128, 128]));
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
		await check('timeline mask uses transformed source bounds', blue, red, { mask: alphaMask, position: [0.5, 0] }, pixels(x => x < 4 ? [0, 0, 0, 0] : [0, 0, 255, 255]));
		await check('timeline inverted mask retains outside source bounds', blue, red, { mask: { ...alphaMask, inverted: true }, position: [0.5, 0] }, pixels(x => x < 4 ? [0, 0, 255, 255] : [0, 0, 0, 0]));
		// 【倍率0は区間外ではなく、有効な透明マスクとして扱う】
		// 透明な生成結果・素材が画面外へ出た場合も同じ被覆率の規則で処理できる。
		await check('timeline zero scale mask clears background', blue, red, { mask: alphaMask, scale: [0, 1] }, solid([0, 0, 0, 0]));
		// 【模様のある素材のAlphaで下層を切り抜く】
		// マスクの左右で異なるAlphaを読み、素材自身の色を描画しないことを確認する。
		const maskTexture = texture(8, 4, pixels(x => x < 4 ? [255, 0, 0, 255] : [0, 0, 0, 0]));
		await check('timeline texture mask reads alpha without drawing its color', blue, maskTexture, { mask: alphaMask }, pixels(x => x < 4 ? [0, 0, 255, 255] : [0, 0, 0, 0]));
		// 半透明の素材にopacityを掛けても、RGBへalphaを二重乗算しない。
		await check('timeline normal opacity preserves premultiplied colors', blue, solidImage([0.5, 0, 0, 0.5]), { opacity: 0.5 }, solid([64, 0, 191, 255]));
		await check('timeline normal combines two translucent layers', solidImage([0, 0, 0.5, 0.5]), solidImage([0.5, 0, 0, 0.5]), { opacity: 0.5 }, solid([64, 0, 96, 159]));
		await check('timeline transparent source leaves background intact', blue, transparent, {}, solid([0, 0, 255, 255]));
		await check('timeline multiply blends straight colors', solidImage([0.8, 0.4, 0.2, 1]), solidImage([0.5, 1, 0.5, 1]), { blendMode: 3 }, solid([102, 102, 26, 255]));
		// 置き換えでは素材のalpha=0も採用し、opacityは背景からの補間量となる。
		await check('timeline replace interpolates transparent output', blue, transparent, { blendMode: 19, opacity: 0.5 }, solid([0, 0, 128, 128]));
		await check('timeline translated source keeps background stationary', blue, red, { position: [0.5, 0] }, pixels(x => x < 4 ? [0, 0, 255, 255] : [255, 0, 0, 255]));
		await check('timeline replace clears translated margins', blue, red, { blendMode: 19, position: [0.5, 0] }, pixels(x => x < 4 ? [0, 0, 0, 0] : [255, 0, 0, 255]));
		await check('timeline replace opacity includes translated margins', blue, red, { blendMode: 19, position: [0.5, 0], opacity: 0.5 }, pixels(x => x < 4 ? [0, 0, 128, 128] : [128, 0, 128, 255]));
		// 正のYは上方向。上下反転の取り違えを検出する。
		await check('timeline positive y moves source upward', blue, red, { position: [0, 0.25] }, pixels((_, y) => y < 2 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
		await check('timeline scale shrinks around canvas center', blue, red, { scale: [0.5, 0.5] }, pixels((x, y) => x >= 2 && x < 6 && y >= 1 && y < 3 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
		await check('timeline rotation respects rectangular aspect ratio', blue, red, { rotation: 0.25 }, pixels(x => x >= 2 && x < 6 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
		// 【素材の右端を画面中央に配置する】
		// Sceneと同じ寸法の素材で、originだけを変えても配置が動くことを確認する。
		await check('timeline anchors the right edge of a scene-sized source at the center', blue, red, { origin: [0.5, 0] }, pixels(x => x < 4 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
		// 【支点の配置先を維持して拡縮する】
		// 拡縮を戻した後にoriginへ戻さないと、倍率に応じて右端が画面中央からずれる。
		await check('timeline scales around the positioned source anchor', blue, red, { origin: [0.5, 0], scale: [0.5, 0.5] }, pixels((x, y) => x < 4 && y >= 1 && y < 3 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
		// 【長方形の素材を端の支点で回転する】
		// 右端を中央に固定して時計回り90度回すと、素材は支点の上側へ伸びる。
		await check('timeline rotates around the positioned source anchor', blue, red, { origin: [0.5, 0], rotation: 0.25 }, pixels((x, y) => x >= 2 && x < 6 && y < 2 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
		// 【fit後も画面端ではなく素材端を支点にする】
		// coverでは画面外の端、containでは余白を除いた素材端を中央へ配置する。
		const wideRed = texture(16, 4, Array.from({ length: 64 }, () => [255, 0, 0, 255]).flat());
		await check('timeline anchors the covered source edge at the center', blue, wideRed, { origin: [0.5, 0], fitMode: 'cover' }, pixels(x => x < 4 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
		await check('timeline anchors the contained source edge at the center', blue, wideRed, { origin: [0.5, 0], fitMode: 'contain' }, pixels((x, y) => x < 4 && y >= 1 && y < 3 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
		await check('timeline zero scale produces transparent source', blue, red, { scale: [0, 1] }, solid([0, 0, 255, 255]));
		await check('timeline replace with zero scale clears background', blue, red, { blendMode: 19, scale: [0, 1] }, solid([0, 0, 0, 0]));
		// 同じ合成器へ模様のあるテクスチャを渡し、左右反転の結果を確認する。
		const striped = texture(8, 4, pixels(x => x < 4 ? [255, 0, 0, 255] : [0, 255, 0, 255]));
		await check('timeline negative scale flips texture source', transparent, striped, { scale: [-1, 1] }, pixels(x => x < 4 ? [0, 255, 0, 255] : [255, 0, 0, 255]));
		// 【適用範囲だけを動かし、処理済み画像の模様は合成先の座標に固定する】
		// 画像まで変形すると右半分に赤が現れる。反転しても画像の左右は入れ替えない。
		const regionSettings = {
			transformTarget: 'region' as const,
			blendMode: 19,
			position: [0.25, 0] as [number, number],
			scale: [0.5, 1] as [number, number],
		};
		const rightGreen = pixels(x => x < 4 ? [0, 0, 255, 255] : [0, 255, 0, 255]);
		await check('timeline region transforms the window without moving its image', blue, striped, regionSettings, rightGreen);
		await check('timeline region reflection leaves image coordinates unchanged', blue, striped, { ...regionSettings, scale: [-0.5, 1] }, rightGreen);
		await check('timeline region rotation leaves image coordinates unchanged', blue, striped, { ...regionSettings, rotation: 0.25 }, rightGreen);
		await check('timeline region opacity interpolates only inside the window', blue, striped, { ...regionSettings, opacity: 0.5 }, pixels(x => x < 4 ? [0, 0, 255, 255] : [0, 128, 128, 255]));
		// 【透明な処理結果は範囲内だけ背景を置換し、潰れた枠・画面外の枠は下層を保つ】
		// 範囲判定をalphaに依存させたり、既存のReplaceの全域置換をそのまま使う退行を検出する。
		await check('timeline region replaces transparent pixels only inside the window', blue, transparent, regionSettings, pixels(x => x < 4 ? [0, 0, 255, 255] : [0, 0, 0, 0]));
		await check('timeline zero scale region preserves the background', blue, transparent, { ...regionSettings, scale: [0, 1] }, solid([0, 0, 255, 255]));
		await check('timeline offscreen region preserves the background', blue, transparent, { ...regionSettings, position: [1.5, 0] }, solid([0, 0, 255, 255]));
		// 【通常合成・マスク・反転マスクでも範囲外へ作用を漏らさない】
		// 画像モードと異なり、透明マスクを移動した先以外の背景まで消してはいけない。
		await check('timeline region normal blending preserves fixed image coordinates', blue, striped, { ...regionSettings, blendMode: 0 }, rightGreen);
		await check('timeline region multiply applies only inside the window', blue, striped, { ...regionSettings, blendMode: colorBlendModes.multiply }, pixels(x => x < 4 ? [0, 0, 255, 255] : [0, 0, 0, 255]));
		await check('timeline region alpha mask preserves the outside background', blue, maskTexture, { ...regionSettings, mask: alphaMask }, pixels(x => x < 4 ? [0, 0, 255, 255] : [0, 0, 0, 0]));
		await check('timeline region inverted mask preserves the outside background', blue, red, { ...regionSettings, mask: { ...alphaMask, inverted: true } }, pixels(x => x < 4 ? [0, 0, 255, 255] : [0, 0, 0, 0]));
		// 【端が画素の中心を通る矩形は、画像のalphaとは独立した被覆率で合成する】
		// 硬い二値判定では移動時に輪郭が1画素ずつ飛ぶため、半画素の被覆を実画素で確認する。
		await check('timeline region antialiases subpixel window edges', blue, red, { ...regionSettings, position: [0.0625, 0] }, pixels(x => x === 2 || x === 6 ? [128, 0, 128, 255] : x > 2 && x < 6 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
		// 【祖先のTransformも枠だけへ反映する】
		// 子のpositionだけで補正すると、親を動かしたときに背景の模様まで移動してしまう。
		await check('timeline region inherits parent placement without transforming pixels', blue, striped, { ...regionSettings, position: [0, 0] }, rightGreen, {
			parent: [1, 0, 0, 1, 0.5, 0],
			depth: 0,
			viewport: {
				left: -1,
				bottom: -1,
				right: 1,
				top: 1,
			},
		});
		// 【長辺画角90°・距離0.5のカメラは、適用範囲を拡大せず平行移動する】
		// 枠の左右端を画面内に収め、旧仕様の距離0.25による2倍拡大を検出する。
		// 画面端まで届く枠では、拡大後のはみ出しがクリップされて同じ結果になる場合がある。
		await check('timeline region inherits camera placement without transforming pixels', blue, striped, { ...regionSettings, position: [0, 0], scale: [0.25, 1] }, pixels(x => x >= 5 && x < 7 ? [0, 255, 0, 255] : [0, 0, 255, 255]), {
			parent: [1, 0, 0, 1, 0, 0],
			depth: 0,
			camera: {
				position: [-0.25, 0],
				z: 0.5,
				roll: 0,
				fieldOfView: 90,
			},
			viewport: {
				left: -1,
				bottom: -1,
				right: 1,
				top: 1,
			},
		});
		// 【背景は配置済みのScene画像として読み、素材の比率で再度Coverしない】
		// 無変形Replaceは素材を借用するため、物理テクスチャの比率がSceneと異なる場合もある。
		const wideBackground = texture(16, 4, Array.from({ length: 4 }, () => Array.from({ length: 16 }, (_, x) => x >= 4 && x < 12 ? [0, 255, 0, 255] : [255, 0, 0, 255])).flat(2));
		// 【範囲はSceneの矩形を使い、出力テクスチャの縦横比やFitで変化しない】
		// カスタム解像度にしても枠と処理結果を再度Contain/Coverして位置をずらさない。
		await check('timeline region ignores texture aspect ratio and image fit', blue, wideBackground, { ...regionSettings, fitMode: 'cover' }, pixels(x => x < 4 ? [0, 0, 255, 255] : x < 6 ? [0, 255, 0, 255] : [255, 0, 0, 255]));
		await check('timeline preserves the full placed background', wideBackground, transparent, {}, pixels(x => x >= 2 && x < 6 ? [0, 255, 0, 255] : [255, 0, 0, 255]));
		await check('timeline fits source using its own dimensions', transparent, wideBackground, { fitMode: 'cover' }, solid([0, 255, 0, 255]));
		if (device.features.has('float32-filterable')) {
			const floatSource = texture(8, 4, solid([0.5, 0, 0, 0.5]), 'rgba32float');
			await check('timeline filters float32 source without double premultiplication', blue, floatSource, { opacity: 0.5 }, solid([64, 0, 191, 255]));
		}
		// 全モードの分岐が実行可能であり、不透明な入力から透明度が失われないことを確認する。
		for (const [name, blendMode] of Object.entries(colorBlendModes)) {
			// Replaceは上の専用ケースで検証する。無変形では素材のテクスチャを借用する。
			if (name === 'none' || name === 'replace') continue;
			const encoder = device.createCommandEncoder();
			const output = compositor.render(encoder, blue, red, { ...defaults, blendMode });
			device.queue.submit([encoder.finish()]);
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
