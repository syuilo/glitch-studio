import { nativeEffectProbe } from './native-effect-probe.ts';
import definition from '../../src/fx/cellTransform/_def_.ts';
import implementationNative from '../../src/fx/cellTransform/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { ShaderInputSampling } from '@gs/shared/gpu/shader-input.ts';
import type { NativeParameterValues } from '../../src/multipass.ts';

const implementation = nativeEffectProbe(definition, implementationNative);

type Parameters = NativeParameterValues<typeof definition.paramDefs>;
type Color = [number, number, number, number];
const vector = (value: [number, number]) => constantShaderInput('vector', value);
const scalar = (value: number) => constantShaderInput('scalar', value);
const transparent: Color = [0, 0, 0, 0];
// 座標を色として読み戻し、負値・HDR・半透明を同時に検証する。
const sourceColor = (x: number, y: number, width = 16, height = 16): Color => [x * 2 / width - 1, y * 2 / height - 1, 2, 0.5];
const image = (width: number, height: number, colorAt: (x: number, y: number) => Color) => Array.from({ length: width * height }, (_, index) => colorAt(index % width, Math.floor(index / width)));

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	device.pushErrorScope('validation');
	const vertex = device.createShaderModule({ code: vertexCode });
	const reader = device.createRenderPipeline({
		layout: 'auto', vertex: { module: vertex },
		fragment: {
			module: device.createShaderModule({ code: `@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(position.xy), 0); }` }),
			targets: [{ format: 'rgba32float' }],
		},
	});
	const defaults = Object.fromEntries(Object.entries(definition.paramDefs).map(([name, parameter]) => [name,
		parameter.canNode === true ? constantShaderInput(parameter.dataType.kind, parameter.defaultValue) : parameter.defaultValue,
	])) as Parameters;
	const checks: string[] = [];
	const disposables: (() => void)[] = [];
	function texture(width: number, height: number, pixels: Color[], sampling: Partial<ShaderInputSampling> = {}) {
		const source = device.createTexture({ size: [width, height], format: 'rgba16float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING });
		device.queue.writeTexture({ texture: source }, new Float16Array(pixels.flat()), { bytesPerRow: width * 8 }, [width, height]);
		disposables.push(() => source.destroy());
		return textureShaderInput(source, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest', ...sampling });
	}
	function createEffect(width: number, height: number) {
		const resolution = { width, height };
		const wgpu = { device, defaultVertexShaderModule: vertex, enable32bitDataTextures: false };
		const output = implementation.createTexture('output', { wgpu, resolution });
		const effect = implementation.place(wgpu, resolution);
		const target = device.createTexture({ size: resolution, format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const bytesPerRow = Math.ceil(width * 16 / 256) * 256;
		const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		const readGroup = device.createBindGroup({ layout: reader.getBindGroupLayout(0), entries: [{ binding: 0, resource: output.createView() }] });
		disposables.push(() => { effect.dispose(); output.destroy(); target.destroy(); buffer.destroy(); });
		return async (overrides: Partial<Parameters> = {}, time = 0) => {
			const encoder = device.createCommandEncoder();
			await effect.draw({
				params: { ...defaults, ...overrides }, commandEncoder: encoder, time, timeDelta: 0,
				pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
				outputs: { output },
			});
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(reader); pass.setBindGroup(0, readGroup); pass.draw(3); pass.end();
			encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow }, resolution);
			device.queue.submit([encoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			const pixels = new Float32Array(width * height * 4);
			try {
				const mapped = new Float32Array(buffer.getMappedRange());
				for (let y = 0; y < height; y++) pixels.set(mapped.subarray(y * bytesPerRow / 4, y * bytesPerRow / 4 + width * 4), y * width * 4);
			} finally { buffer.unmap(); }
			const error = await device.popErrorScope();
			device.pushErrorScope('validation');
			if (error != null) throw new Error(error.message);
			return pixels;
		};
	}
	function compare(actual: Float32Array, expected: Color[], label: string) {
		const components = expected.flat();
		if (actual.length !== components.length) throw new Error(`${label}: dimensions`);
		actual.forEach((value, index) => {
			if (!Number.isFinite(value) || Math.abs(value - components[index]) > 0.001) throw new Error(`${label}: pixel ${Math.floor(index / 4)} channel ${index % 4}: ${value} != ${components[index]}`);
		});
		checks.push(label);
	}
	try {
		const input = texture(16, 16, image(16, 16, sourceColor));
		const render = createEffect(16, 16);
		const base: Partial<Parameters> = { input, frequency: [4, 4], sourcePositionMode: 'input', perCellSourcePosition: vector([0.25, 0.125]), wrapReference: 'image' };
		const selectedPatch = image(16, 16, (x, y) => sourceColor(10 + x % 4, 4 + y % 4));

		// 【定数の参照元座標はセル内の細部を保持し、ゼロ座標も画像中央として扱う】
		// 変形なしの短絡経路で入力画像を返したり、座標のY方向を反転してしまう不具合を検出する。
		compare(await render(base), selectedPatch, 'constant source center preserves local detail and HDR');
		compare(await render({ ...base, perCellSourcePosition: vector([0, 0]) }), image(16, 16, (x, y) => sourceColor(6 + x % 4, 6 + y % 4)), 'zero source position selects canvas center');
		compare(await render({ ...base, wrapReference: 'cell' }), selectedPatch, 'cell wrapping also selects the requested source patch');

		// 【座標場はセルの中心で読み、画像片を左右に並べ替えても内部の向きを保持する】
		// alpha=0の連続座標場により、色扱い・画素単位の変形・参照元での再評価を検出する。
		const coordinates = texture(16, 16, image(16, 16, (x, y) => [-(x + 0.5 - 8) / 16, (8 - y - 0.5) / 16, 0, 0]), { filterMode: 'linear' });
		const mirroredCells = image(16, 16, (x, y) => sourceColor((3 - Math.floor(x / 4)) * 4 + x % 4, y));
		compare(await render({ ...base, perCellSourcePosition: coordinates }), mirroredCells, 'coordinate field selects distinct source cells');
		compare(await render({ ...base, perCellSourcePosition: coordinates, controlSamples: 3 }), mirroredCells, 'multiple control samples average source coordinates');
		compare(await render({ ...base, perCellSourcePosition: coordinates, sourcePositionMode: 'cell' }), image(16, 16, sourceColor), 'cell center mode ignores connected source coordinates');
		compare(await render(base, 100), selectedPatch, 'source mode switches back and is independent of time');

		// 【参照元の中心は拡縮・回転・移動へ巻き込まず、選んだ領域の内容だけを変形する】
		// 原点周りで絶対座標を変形してしまう誤りと、Translationの符号・単位の回帰を防ぐ。
		compare(await render({ ...base, perCellScale: vector([2, 2]), perCellRotation: scalar(0.25) }), image(16, 16, (x, y) => sourceColor(11 + Math.floor(y % 4 / 2), 6 - Math.floor(x % 4 / 2))), 'scale and rotation preserve source pivot');
		const translatedPatch = image(16, 16, (x, y) => sourceColor(9 + x % 4, 3 + y % 4));
		compare(await render({ ...base, perCellTranslation: vector([0.25, -0.25]) }), translatedPatch, 'cell translation moves selected content');
		compare(await render({ ...base, translationUnit: 'canvas', perCellTranslation: vector([0.0625, -0.0625]) }), translatedPatch, 'canvas translation preserves common units');
		compare(await render({ ...base, perCellScale: vector([0, 1]) }), image(16, 16, () => transparent), 'zero scale stays transparent');

		// 【格子の回転とAdaptive分割で参照元の座標系を変えない】
		// 長方形のセルを回転させても参照中心は固定し、細分化後の葉の相対位置だけを使う。
		compare(await render({ ...base, angle: 0.25, frequency: [4, 2], perCellSourcePosition: vector([0, 0]) }), image(16, 16, (x, y) => sourceColor(4 + x % 8, 6 + y % 4)), 'rotated rectangular grid preserves source coordinates');
		compare(await render({ ...base, frequency: [2, 2], subdivisionMode: 'adaptive', maxSubdivisionLevels: 1, densityMap: scalar(1) }), selectedPatch, 'adaptive leaves preserve source center and local detail');

		// 【画像外の参照は選択したWrapを使い、制御入力自身のWrapは変更しない】
		// 主入力の接続はClampなので、Image側のWrap設定が確実に優先されることも確認できる。
		for (const cellWrapMode of ['transparent', 'clamp', 'repeat', 'repeatMirrored'] as const) {
			const expected = image(16, 16, (x, y) => {
				const sourceX = 14 + x % 4;
				if (sourceX < 16) return sourceColor(sourceX, 6 + y % 4);
				if (cellWrapMode === 'transparent') return transparent;
				return sourceColor(cellWrapMode === 'clamp' ? 15 : cellWrapMode === 'repeat' ? sourceX - 16 : 31 - sourceX, 6 + y % 4);
			});
			compare(await render({ ...base, perCellSourcePosition: vector([0.5, 0]), cellWrapMode }), expected, `image boundary ${cellWrapMode}`);
		}
		// 縮小後の参照点が画素境界に重ならないよう、参照中心を半画素ずらす。
		// Nearestの同点処理や補間座標の丸めではなく、選んだ画像片内の反復を検証する。
		compare(await render({ ...base, perCellSourcePosition: vector([0.28125, 0.09375]), wrapReference: 'cell', cellWrapMode: 'repeat', perCellScale: vector([0.5, 0.5]) }), image(16, 16, (x, y) => sourceColor(x % 2 === 0 ? 13 : 11, y % 2 === 0 ? 7 : 5)), 'cell wrapping repeats around selected source center');

		// 【入力Fitは画面全体へ適用し、座標場の値やセルごとの画像片を再Fitしない】
		// 素材と出力の比率が異なる場合も、共通座標の参照位置から同じ画像領域を切り出せる。
		const fittedInput = texture(8, 4, image(8, 4, (x, y) => sourceColor(x, y, 8, 4)), { fitMode: 'contain' });
		compare(await render({ ...base, input: fittedInput, perCellSourcePosition: vector([0, 0]) }), image(16, 16, (x, y) => sourceColor(3 + Math.floor(x % 4 / 2), 1 + Math.floor(y % 4 / 2), 8, 4)), 'source positions respect whole image fit');

		// 【縦横比・解像度・Size Referenceを変更しても絶対座標の単位を保つ】
		// 長辺全体の1/8だけ右上という同じ参照元を、横長・縦長・倍解像度で確認する。
		for (const [width, height] of [[16, 8], [8, 16], [32, 16]]) {
			const rectangularRender = createEffect(width, height);
			const rectangularInput = texture(width, height, image(width, height, (x, y) => sourceColor(x, y, width, height)));
			const cellSize = Math.max(width, height) / 4;
			for (const sizeReference of ['longSide', 'shortSide'] as const) {
				const frequency = sizeReference === 'longSide' ? 4 : 2;
				compare(await rectangularRender({ ...base, input: rectangularInput, frequency: [frequency, frequency], sizeReference, perCellSourcePosition: vector([0.125, 0.125]) }), image(width, height, (x, y) => sourceColor(width / 2 + x % cellSize, height / 2 - cellSize + y % cellSize, width, height)), `${width}x${height} ${sizeReference} source units`);
			}
		}

		// 【定数色にも画像外のTransparentを適用し、Opacityはpremultiplied RGBA全体へ掛ける】
		// テクスチャ入力だけでなくuniform経路と、半透明・負値・HDRを保つことを確認する。
		const color: Color = [-0.5, 2, 0.25, 0.5];
		// リテラルは未乗算色で渡し、ShaderInputの生成時に一度だけalphaを乗算する。
		const constantInput = constantShaderInput('color', [-1, 4, 0.5, 0.5]);
		compare(await render({ ...base, input: constantInput, perCellOpacity: scalar(0.5) }), image(16, 16, () => [-0.25, 1, 0.125, 0.25]), 'constant input preserves premultiplied opacity');
		compare(await render({ ...base, input: constantInput, perCellSourcePosition: vector([2, -2]) }), image(16, 16, () => transparent), 'constant input outside canvas is transparent');
		compare(await render({ ...base, input: constantInput, perCellSourcePosition: vector([2, -2]), cellWrapMode: 'repeat' }), image(16, 16, () => color), 'constant input repeat covers distant source positions');
		return { checks };
	} finally {
		for (const dispose of disposables.reverse()) dispose();
		device.destroy();
	}
}
