import definition from '../../src/fx/cellMatch/_def_.ts';
import implementation from '../../src/fx/cellMatch/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { ShaderInputSampling } from '@gs/shared/gpu/shader-input.ts';
import type { RuntimeEffectParameters } from '../../src/effect-implementation.ts';

type Parameters = RuntimeEffectParameters<typeof definition.paramDefs>;
type Color = [number, number, number, number];
const gray = (value: number, alpha = 1): Color => [value * alpha, value * alpha, value * alpha, alpha];
const rowImage = (values: number[], height = 2) => Array.from({ length: height }, () => values.map(value => gray(value))).flat();

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	device.pushErrorScope('validation');
	const vertex = device.createShaderModule({ code: vertexCode });
	const readerLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }] });
	const reader = device.createRenderPipeline({
		layout: device.createPipelineLayout({ bindGroupLayouts: [readerLayout] }),
		vertex: { module: vertex },
		fragment: {
			module: device.createShaderModule({ code: `@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(p.xy), 0); }` }),
			targets: [{ format: 'rgba32float' }],
		},
	});
	const defaults: Parameters = {
		input: constantShaderInput('color', [0, 0, 0, 0]), frequency: [4, 4], phase: [0, 0.5], sizeReference: 'longSide',
		reference: constantShaderInput('color', [0, 0, 0, 0]), matchBy: 'color', positionBias: 0,
		samplesPerCell: 16, iterations: 128,
	};
	const checks: string[] = [];
	const disposables: (() => void)[] = [];
	function texture(width: number, height: number, pixels: Color[], sampling: Partial<ShaderInputSampling> = {}) {
		if (pixels.length !== width * height) throw new Error('Invalid test image size');
		const image = device.createTexture({ size: [width, height], format: 'rgba16float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING });
		device.queue.writeTexture({ texture: image }, new Float16Array(pixels.flat()), { bytesPerRow: width * 8 }, [width, height]);
		disposables.push(() => image.destroy());
		return textureShaderInput(image, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest', ...sampling });
	}
	function createEffect(width: number, height: number) {
		const resolution = { width, height };
		const wgpu = { device, defaultVertexShaderModule: vertex, intermediateTextureFormat: 'rgba16float' as const, enable32bitDataTextures: false };
		const output = implementation.outputTextureFactories.output({ wgpu, resolution });
		const effect = implementation.init({ wgpu, resolution, params: defaults, resources: {}, fallbackTexture: output, reportStatus: () => {} });
		const copyTarget = device.createTexture({ size: resolution, format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const bytesPerRow = Math.ceil(width * 16 / 256) * 256;
		const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		const readGroup = device.createBindGroup({ layout: readerLayout, entries: [{ binding: 0, resource: output.createView() }] });
		disposables.push(() => { effect.dispose(); output.destroy(); copyTarget.destroy(); buffer.destroy(); });
		return async (overrides: Partial<Parameters> = {}, time = 0) => {
			const commandEncoder = device.createCommandEncoder();
			effect.render({
				params: { ...defaults, ...overrides }, commandEncoder, time, timeDelta: 0,
				pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
				outputDataMap: { output: { texture: output, textureView: output.createView(), previousFrameTexture: null, previousFrameTextureView: null } },
				createPassEncoder: (encoder, descriptor) => encoder.beginRenderPass(descriptor),
				createComputePassEncoder: encoder => encoder.beginComputePass(),
				createPassEncoderFor: (encoder, view) => encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
			});
			const pass = commandEncoder.beginRenderPass({ colorAttachments: [{ view: copyTarget.createView(), loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(reader); pass.setBindGroup(0, readGroup); pass.draw(3); pass.end();
			commandEncoder.copyTextureToBuffer({ texture: copyTarget }, { buffer, bytesPerRow }, resolution);
			device.queue.submit([commandEncoder.finish()]);
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
		const render = createEffect(4, 4);
		const fragmentPixels = [
			0, 0.125, 0.25, 0.375,
			0, 0.125, 0.25, 0.375,
			0.5, 0.625, 0.75, 0.875,
			0.5, 0.625, 0.75, 0.875,
		].map(value => gray(value));
		const expectedFragments = [
			0.75, 0.875, 0.5, 0.625,
			0.75, 0.875, 0.5, 0.625,
			0.25, 0.375, 0, 0.125,
			0.25, 0.375, 0, 0.125,
		].map(value => gray(value));
		const input = texture(4, 4, fragmentPixels);
		const reference = texture(2, 2, [0.8125, 0.5625, 0.3125, 0.0625].map(value => gray(value)));
		const base: Partial<Parameters> = { input, reference, frequency: [2, 2], phase: [0, 0] };

		// 【画面全体で画像片を交換し、セル内の細部と異なる入力解像度を保つ】
		// 行・列内だけの交換や、平均色で塗りつぶす実装では既知の4セルの配置にならない。
		compare(await render(base), expectedFragments, 'global matching preserves image fragments');
		// 【同じ参照・一様な参照・探索0では不要な移動をしない】
		// 同点で交換すると静止画でも意味のないシャッフルが生じるため、元配置からの開始を確認する。
		compare(await render({ ...base, reference: input }), fragmentPixels, 'self reference preserves original pixels');
		compare(await render({ ...base, reference: constantShaderInput('color', [0.5, 0.5, 0.5, 1]) }), fragmentPixels, 'uniform reference retains tied assignments');
		compare(await render({ ...base, iterations: 0 }), fragmentPixels, 'zero iterations preserves original pixels');
		compare(await render({ ...base, frequency: [1, 1], phase: [0.5, 0.5] }), fragmentPixels, 'single cell preserves original pixels');
		compare(await render(base), expectedFragments, 'grid grows again after a single cell');

		// 【セル中心だけでなく画像片全体の平均色で配置する】
		// 中心画素の明暗と平均の大小が逆になる画像片で、Samples Per Cellによる解析を確認する。
		const meanRender = createEffect(4, 2);
		const meanBase: Partial<Parameters> = {
			input: texture(4, 2, rowImage([1, 0, 0.125, 0.625])), reference: texture(2, 1, [gray(0.375), gray(0.5)]),
			frequency: [2, 2], phase: [0, 0.5],
		};
		compare(await meanRender(meanBase), rowImage([0.125, 0.625, 1, 0]), 'matching analyzes the full fragment mean');

		// 【色と輝度の比較基準を切り替える】
		// 赤・緑に対して黄・青を参照すると、RGB距離は元配置、明暗の比較は逆配置を優先する。
		const red: Color = [1, 0, 0, 1];
		const green: Color = [0, 0.5, 0, 1];
		const colorInput = texture(2, 1, [red, green]);
		const colorReference = texture(2, 1, [[1, 1, 0, 1], [0, 0, 1, 1]]);
		const pairRender = createEffect(2, 1);
		const pairBase: Partial<Parameters> = { input: colorInput, reference: colorReference, frequency: [2, 2], phase: [0, 0.5] };
		compare(await pairRender(pairBase), [red, green], 'average color evaluates RGB differences');
		compare(await pairRender({ ...pairBase, matchBy: 'luminance' }), [green, red], 'average luminance evaluates light and dark');
		compare(await pairRender(pairBase), [red, green], 'switching back resets the assignment');

		// 【移動距離の重みで元配置を優先し、HDRの色差も保持する】
		// 候補間の交換だけを止める強さが働き、色の解析を0〜1へ制限しないことを確認する。
		const pairInput = texture(2, 1, [gray(0), gray(1)]);
		const pairReference = texture(2, 1, [gray(1), gray(0)]);
		const positionBase: Partial<Parameters> = { ...pairBase, input: pairInput, reference: pairReference };
		compare(await pairRender(positionBase), [gray(1), gray(0)], 'zero position bias follows the reference');
		compare(await pairRender({ ...positionBase, positionBias: 10 }), [gray(0), gray(1)], 'position bias retains the original placement');
		compare(await pairRender({ ...pairBase, input: texture(2, 1, [gray(2), gray(4)]), reference: texture(2, 1, [gray(4), gray(2)]) }), [gray(4), gray(2)], 'HDR colors are not clamped for matching');

		// 【透明な部分を黒と見なさず、移動する画像片のRGBAを維持する】
		// 未乗算の代表色で比較しないと、半透明の白より不透明な灰色を明るい参照に割り当ててしまう。
		const visibleGray = gray(0.5);
		const translucentWhite = gray(1, 0.25);
		compare(await pairRender({
			...pairBase, input: texture(2, 1, [visibleGray, translucentWhite]), reference: texture(2, 1, [gray(0.8), gray(0.6)]),
		}), [translucentWhite, visibleGray], 'representative color excludes transparent black');
		const alphaPixels = [gray(1, 0.25), gray(0, 0), gray(0.5, 1)];
		const alphaExpected = [alphaPixels[2], alphaPixels[0], alphaPixels[1]];
		const alphaRender = createEffect(3, 1);
		compare(await alphaRender({
			input: texture(3, 1, alphaPixels), reference: texture(3, 1, alphaExpected), frequency: [3, 3], phase: [0.5, 0.5],
		}), alphaExpected, 'mean alpha places transparent fragments without double premultiplication');
		compare(await meanRender({
			...meanBase,
			input: texture(4, 2, Array.from({ length: 2 }, () => [gray(0.5), gray(0.5), gray(1), gray(0, 0)]).flat()),
			reference: texture(2, 1, [gray(0.8), gray(0.6)]),
		}), Array.from({ length: 2 }, () => [gray(1), gray(0, 0), gray(0.5), gray(0.5)]).flat(), 'transparent pixels do not darken the representative fragment color');

		// 【端の画像片は本来の寸法で交換し、両入力とも描画領域で反射する】
		// 接続のWrapはrepeatにし、素材端のrepeatや切り取り・引き伸ばしを使う誤りを検出する。
		const edgeRow = [0.75, 0.5, 0.25, 0.125, 0, 0.0625];
		const edgeInput = texture(6, 2, rowImage(edgeRow), { wrapMode: 'repeat' });
		const edgeReference = texture(6, 2, rowImage([0.0625, 0.0625, 0.0625, 0.5625, 0.5625, 0.5625]), { wrapMode: 'repeat' });
		const edgeRender = createEffect(6, 2);
		const edgeBase: Partial<Parameters> = { input: edgeInput, reference: edgeReference, frequency: [1.5, 3], phase: [0, 0.5] };
		compare(await edgeRender(edgeBase), rowImage([0, 0.0625, 0.0625, 0.75, 0.75, 0.5]), 'partial edge cells mirror without stretching');
		// 【副入力側の欠けた領域も反射して解析する】
		// repeatで読むと左右の平均の大小が逆転する参照を使い、主入力だけ反射する実装を検出する。
		compare(await edgeRender({
			...edgeBase, reference: texture(6, 2, rowImage([1, 0, 0, 0.25, 0.25, 0]), { wrapMode: 'repeat' }),
		}), rowImage(edgeRow), 'reference analysis mirrors the full edge cells');
		const shiftedReference = texture(6, 2, rowImage([0.109375, 0.109375, 0.625, 0.625, 0.625, 0.625]));
		const shiftedEdge = [0, 0.0625, 0.5, 0.75, 0.75, 0.5];
		compare(await edgeRender({ ...edgeBase, reference: shiftedReference, phase: [0.25, 0.5] }), rowImage(shiftedEdge), 'fractional phase preserves complete mirrored fragments');
		const verticalEdgeRender = createEffect(2, 6);
		compare(await verticalEdgeRender({
			input: texture(2, 6, edgeRow.flatMap(value => [gray(value), gray(value)])),
			reference: texture(2, 6, [0.109375, 0.109375, 0.625, 0.625, 0.625, 0.625].flatMap(value => [gray(value), gray(value)])),
			frequency: [3, 1.5], phase: [0.5, -0.25],
		}), shiftedEdge.flatMap(value => [gray(value), gray(value)]), 'vertical phase follows positive upward coordinates');
		const fittedInput = texture(2, 2, rowImage([0.75, 0.25]), { fitMode: 'contain', wrapMode: 'transparent' });
		const fittedReference = texture(6, 2, Array.from({ length: 2 }, () => [
			gray(0.25, 0.25), gray(0.25, 0.25), gray(0.25, 0.25), gray(0.75, 0.25), gray(0.75, 0.25), gray(0.75, 0.25),
		]).flat());
		compare(await edgeRender({ ...edgeBase, input: fittedInput, reference: fittedReference }), Array.from({ length: 12 }, () => gray(0, 0)), 'mirror boundary follows canvas before connection fit');

		// 【奇数個のセルでもダミーを参照せず、画像片を一度ずつ使う】
		// 2冪への切り上げや円環法の端処理でセルが失われる不具合を、小さな既知の配置で検出する。
		const oddRow = [0, 0.125, 0.5, 0.625, 0.25, 0.375];
		compare(await edgeRender({
			input: texture(6, 2, rowImage(oddRow)), reference: texture(3, 1, [gray(0.5625), gray(0.3125), gray(0.0625)]),
			frequency: [3, 3], phase: [0.5, 0.5],
		}), rowImage([0.5, 0.625, 0.25, 0.375, 0, 0.125]), 'odd cell counts retain every fragment');

		// 【workgroupをまたぐ交換でも重複・欠落がなく、反復を増やすと誤差が増えない】
		// 131セルでは256参加者・128ペアとなり、交換にも複数workgroupが必要になる。
		// 奇数個の実セルとダミーを混ぜ、実際のstorage bufferの競合を確認する。
		const longRow = Array.from({ length: 131 }, (_, index) => index / 256).flatMap(value => [value, value]);
		const longPixels = rowImage(longRow);
		const longTarget = rowImage([...longRow].reverse());
		const longRender = createEffect(262, 2);
		const longBase: Partial<Parameters> = { input: texture(262, 2, longPixels), reference: texture(262, 2, longTarget), frequency: [131, 131], phase: [0.5, 0.5] };
		let previousError = Number.POSITIVE_INFINITY;
		let initialError = 0;
		for (const iterations of [0, 1, 8, 64, 256]) {
			const actual = await longRender({ ...longBase, iterations });
			const actualColors = Array.from({ length: longPixels.length }, (_, index) => Array.from(actual.subarray(index * 4, index * 4 + 4)) as Color);
			const sortedActual = new Float32Array(actualColors.sort((first, second) => first[0] - second[0]).flat());
			const sortedExpected = [...longPixels].sort((first, second) => first[0] - second[0]);
			compare(sortedActual, sortedExpected, `bijective assignments across workgroups at ${iterations} iterations`);
			const error = actual.reduce((sum, value, index) => sum + (value - longTarget[Math.floor(index / 4)][index % 4]) ** 2, 0);
			if (error > previousError + 0.0001) throw new Error('Increasing iterations increased the matching error');
			if (iterations === 0) initialError = error;
			previousError = error;
		}
		if (!(previousError < initialError)) throw new Error('Matching did not improve the image');
		checks.push('additional iterations reduce reference error');

		// 【同じ縦横比の解像度変更とSize Referenceで配置を保つ】
		// 出力画素数に合わせて解析や格子を変えず、格子の各軸に同じ基準寸法を使うことを確認する。
		const scaledRender = createEffect(8, 8);
		const scaledExpected = Array.from({ length: 8 }, (_, y) => Array.from({ length: 8 }, (_, x) => expectedFragments[Math.floor(y / 2) * 4 + Math.floor(x / 2)])).flat();
		compare(await scaledRender(base), scaledExpected, 'resolution independent matching and sampling');
		for (const sizeReference of ['width', 'height', 'shortSide', 'longSide'] as const) {
			compare(await edgeRender({
				...edgeBase, sizeReference, frequency: sizeReference === 'height' || sizeReference === 'shortSide' ? [0.5, 1] : [1.5, 3],
			}), rowImage([0, 0.0625, 0.0625, 0.75, 0.75, 0.5]), `${sizeReference} size reference`);
		}
		compare(await render({ ...base, phase: [-2, 3] }), expectedFragments, 'integer phase periods preserve matching');

		// 【解析数・入力種別・探索容量の切替後も古い割当やuniformを使わない】
		// 定数とテクスチャの全組合せ、非平方数の解析数、buffer容量が増える経路を同じinstanceで検証する。
		for (const samplesPerCell of [1, 3, 7, 16, 256]) {
			compare(await pairRender({ ...positionBase, samplesPerCell }), [gray(1), gray(0)], `${samplesPerCell} equal area samples`);
		}
		const constantPixels = Array.from({ length: 16 }, () => [0.25, 0.125, 0.5, 0.5] as Color);
		const constantInput = constantShaderInput('color', [0.5, 0.25, 1, 0.5]);
		compare(await render({ ...base, input: constantInput }), constantPixels, 'constant input with texture reference');
		compare(await render({ ...base, input: constantInput, reference: constantShaderInput('color', [0, 0, 0, 0]) }), constantPixels, 'two constant inputs stay premultiplied once');
		compare(await render({ ...base, iterations: 1024 }), expectedFragments, 'iteration buffer capacity grows safely');
		compare(await render({ ...base, iterations: NaN, samplesPerCell: NaN, positionBias: NaN, phase: [NaN, NaN] }), expectedFragments, 'nonfinite controls use finite defaults');
		compare(await render(base, 100), expectedFragments, 'time and previous input changes do not affect matching');

		// 【GPU上限を超える格子は精度を落とさず拒否する】
		// プレビューと書き出しでセル数が変わる自動間引きや、不正なbuffer確保を防ぐ。
		let rejected = false;
		try { await render({ ...base, frequency: [1e12, 1e12] }); } catch (error) { rejected = error instanceof Error && error.message.includes('GPU resource limits'); }
		if (!rejected) throw new Error('Oversized grid was not rejected');
		checks.push('oversized cell grids are rejected');
		return { checks };
	} finally {
		for (const dispose of disposables.reverse()) dispose();
		device.destroy();
	}
}
