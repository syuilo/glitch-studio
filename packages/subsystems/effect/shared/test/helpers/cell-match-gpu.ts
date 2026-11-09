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
const cellImage = (cells: Color[][], cellWidth: number, cellHeight: number) => Array.from({ length: cellHeight }, (_, row) => cells.flatMap(cell => cell.slice(row * cellWidth, (row + 1) * cellWidth))).flat();

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
		reference: constantShaderInput('color', [0, 0, 0, 0]), placementMode: 'oneToOne', matchBy: 'color', positionBias: 0,
		structureGrid: '2x2', samplesPerCell: 16, iterations: 128,
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
		const wgpu = { device, defaultVertexShaderModule: vertex, enable32bitDataTextures: false };
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

		// 【再利用では各配置先の最適セルを独立に選び、細部を保ったまま何度でも配置する】
		// 同じ画像片を二度使う参照を用い、一対一の交換や平均色の塗りつぶしで代用する実装を防ぐ。
		const reuseBase: Partial<Parameters> = {
			...base, placementMode: 'reuse', reference: texture(2, 2, [0.8125, 0.8125, 0.0625, 0.5625].map(value => gray(value))),
		};
		const reusedFragments = [
			0.75, 0.875, 0.75, 0.875,
			0.75, 0.875, 0.75, 0.875,
			0, 0.125, 0.5, 0.625,
			0, 0.125, 0.5, 0.625,
		].map(value => gray(value));
		compare(await render(reuseBase), reusedFragments, 'reuse independently selects the best fragment at every destination');
		compare(await render({ ...reuseBase, iterations: 0 }), reusedFragments, 'reuse searches every candidate even with zero one-to-one iterations');
		compare(await render({ ...reuseBase, iterations: 1024 }), reusedFragments, 'one-to-one iteration count does not change reusable placement');
		compare(await render({ ...base, placementMode: 'oneToOne' }), expectedFragments, 'switching from reuse restores bijective placement');
		compare(await render(reuseBase, 100), reusedFragments, 'reusable placement is independent of previous modes and time');
		compare(await render({ ...reuseBase, frequency: [1, 1], phase: [0.5, 0.5] }), fragmentPixels, 'reuse with a single cell retains the original image');

		// 【再利用でも同点の元セルを優先し、他の候補はセル番号で安定させる】
		// 平均色が同じで細部だけが異なる画像片を使い、集約laneの順序に依存した選択を検出する。
		compare(await edgeRender({
			input: texture(6, 2, rowImage([0, 1, 0.875, 0.875, 1, 0])), reference: constantShaderInput('color', [0.5, 0.5, 0.5, 1]),
			placementMode: 'reuse', frequency: [3, 3], phase: [0.5, 0.5],
		}), rowImage([0, 1, 0, 1, 1, 0]), 'reuse prefers original ties then the lowest candidate index');
		compare(await render({ ...base, reference: input, placementMode: 'reuse' }), fragmentPixels, 'reuse with self reference preserves original fragments');

		// 【再利用でも色・輝度・位置の重みを同じ基準で評価する】
		// 一対一方式の候補評価を共用し、方式の切替で一部の設定だけが無視される不具合を防ぐ。
		compare(await pairRender({ ...pairBase, placementMode: 'reuse' }), [red, green], 'reuse evaluates average RGB differences');
		compare(await pairRender({ ...pairBase, placementMode: 'reuse', matchBy: 'luminance' }), [green, red], 'reuse evaluates average luminance differences');
		const uniformWhiteReference = constantShaderInput('color', [1, 1, 1, 1]);
		compare(await pairRender({ ...positionBase, placementMode: 'reuse', reference: uniformWhiteReference }), [gray(1), gray(1)], 'reuse can choose the same source for a uniform reference');
		compare(await pairRender({ ...positionBase, placementMode: 'reuse', reference: uniformWhiteReference, positionBias: 10 }), [gray(0), gray(1)], 'reuse honors the original position bias');

		// 【再利用は透明セルも繰り返せ、セル内の透明画素をそのまま保持する】
		// RGBの代表色だけで透明セルを黒と取り違えたり、複製時にalphaを二重乗算する処理を検出する。
		const reusedAlpha = [alphaPixels[2], alphaPixels[2], alphaPixels[1]];
		compare(await alphaRender({
			input: texture(3, 1, alphaPixels), reference: texture(3, 1, reusedAlpha), placementMode: 'reuse', frequency: [3, 3], phase: [0.5, 0.5],
		}), reusedAlpha, 'reuse selects opaque and fully transparent fragments by alpha');
		compare(await meanRender({
			...meanBase, placementMode: 'reuse',
			input: texture(4, 2, Array.from({ length: 2 }, () => [gray(0.5), gray(0.5), gray(1), gray(0, 0)]).flat()),
			reference: constantShaderInput('color', [1, 1, 1, 0.5]),
		}), Array.from({ length: 2 }, () => [gray(1), gray(0, 0), gray(1), gray(0, 0)]).flat(), 'reuse preserves transparent pixels inside repeated fragments');
		compare(await render({ ...reuseBase, input: constantInput }), constantPixels, 'reuse supports constant color inputs');

		// 【再利用する端セルも反射した本来の寸法を保ち、副入力も同じ領域で解析する】
		// 欠けた端を拡大して配置したり、副入力だけ接続のrepeatで読む実装を防ぐ。
		compare(await edgeRender({
			...edgeBase, placementMode: 'reuse', reference: constantShaderInput('color', [0.0625, 0.0625, 0.0625, 1]),
		}), rowImage([0, 0.0625, 0.0625, 0.125, 0, 0.0625]), 'reused edge fragments retain mirrored hidden parts without stretching');
		compare(await edgeRender({
			...edgeBase, placementMode: 'reuse', reference: texture(6, 2, rowImage([1, 0, 0, 0.25, 0.25, 0]), { wrapMode: 'repeat' }),
		}), rowImage(edgeRow), 'reuse analyzes mirrored reference edges');

		// 【64laneを超える候補と非2冪のセル数でも、全候補から最小誤差を選ぶ】
		// 131番目の候補だけが一致する参照で、先頭64件だけを探す打ち切りや集約の端処理を検出する。
		compare(await longRender({
			...longBase, placementMode: 'reuse', reference: constantShaderInput('color', [130 / 256, 130 / 256, 130 / 256, 1]),
		}), Array.from({ length: longPixels.length }, () => gray(130 / 256)), 'reuse searches candidates beyond the first two lane batches');
		const scaledReusedFragments = Array.from({ length: 8 }, (_, y) => Array.from({ length: 8 }, (_, x) => reusedFragments[Math.floor(y / 2) * 4 + Math.floor(x / 2)])).flat();
		compare(await scaledRender(reuseBase), scaledReusedFragments, 'reusable placement is resolution independent');

		// 【平均色が同じでも左右・上下の配置を区別し、両配置方式で画像片を交換する】
		// 全体平均だけでは区別できない縦横の白黒模様を使い、領域の対応とY方向を確認する。
		const verticalPattern = [0, 1, 0, 1].map(value => gray(value));
		const horizontalPattern = [0, 0, 1, 1].map(value => gray(value));
		const structurePixels = cellImage([verticalPattern, horizontalPattern], 2, 2);
		const structureExpected = cellImage([horizontalPattern, verticalPattern], 2, 2);
		const structureRender = createEffect(4, 2);
		const structureBase: Partial<Parameters> = {
			input: texture(4, 2, structurePixels), reference: texture(4, 2, structureExpected), frequency: [2, 2], phase: [0, 0.5],
		};
		for (const placementMode of ['oneToOne', 'reuse'] as const) {
			compare(await structureRender({ ...structureBase, placementMode }), structurePixels, `${placementMode} whole averages cannot distinguish spatial patterns`);
			for (const structureGrid of ['2x2', '4x4'] as const) {
				compare(await structureRender({ ...structureBase, placementMode, matchBy: 'structure', structureGrid }), structureExpected, `${placementMode} ${structureGrid} matches vertical and horizontal structures`);
			}
		}

		// 【4×4では2×2領域内の模様を比較し、モード切替で解析bufferを作り直す】
		// 各2×2領域の平均まで同じな反転チェッカーで、全体平均や2×2での代用を検出する。
		const checkerPattern = Array.from({ length: 16 }, (_, index) => gray((Math.floor(index / 4) + index % 4) % 2));
		const invertedCheckerPattern = checkerPattern.map(color => gray(1 - color[0]));
		const detailPixels = cellImage([checkerPattern, invertedCheckerPattern], 4, 4);
		const detailExpected = cellImage([invertedCheckerPattern, checkerPattern], 4, 4);
		const detailRender = createEffect(8, 4);
		const detailBase: Partial<Parameters> = {
			input: texture(8, 4, detailPixels), reference: texture(8, 4, detailExpected), frequency: [2, 2], phase: [0, 0.5], matchBy: 'structure',
		};
		for (const placementMode of ['oneToOne', 'reuse'] as const) {
			compare(await detailRender({ ...detailBase, placementMode, structureGrid: '2x2' }), detailPixels, `${placementMode} 2x2 retains tied region means`);
			compare(await detailRender({ ...detailBase, placementMode, structureGrid: '4x4' }), detailExpected, `${placementMode} 4x4 distinguishes fine checker structure`);
			compare(await detailRender({ ...detailBase, placementMode, structureGrid: '4x4', positionBias: 10 }), detailPixels, `${placementMode} structure errors are normalized before position bias`);
			compare(await detailRender({ ...detailBase, placementMode, matchBy: 'color', structureGrid: '4x4' }), detailPixels, `${placementMode} average color ignores the structure grid`);
			compare(await detailRender({ ...detailBase, placementMode, matchBy: 'luminance', structureGrid: '4x4' }), detailPixels, `${placementMode} switching back to average luminance clears structural features`);
		}

		// 【領域数より少ない解析数でも全領域を読み、非2冪の予算も空領域を作らず配分する】
		// Samples Per Cell=1で一部の領域が未解析になることや、0除算で比較できなくなることを防ぐ。
		for (const samplesPerCell of [1, 3, 7, 17, 31, 256]) {
			compare(await detailRender({ ...detailBase, structureGrid: '4x4', samplesPerCell }), detailExpected, `4x4 structure uses every region with ${samplesPerCell} requested samples`);
		}
		compare(await detailRender({ ...detailBase, structureGrid: '4x4', reference: detailBase.input }), detailPixels, 'structural self reference preserves source pixels');
		compare(await detailRender({ ...detailBase, structureGrid: '4x4', iterations: 0 }), detailPixels, 'zero one-to-one iterations bypass structural matching');
		compare(await detailRender({ ...detailBase, structureGrid: '4x4' }, 100), detailExpected, 'structural matching is independent of render history and time');

		// 【再利用では構造が一致する画像片を複数の配置先へ置く】
		// 平均色が同じ候補から、参照の構造だけを根拠に同じ画像片を繰り返し選べることを確認する。
		const repeatedPattern = cellImage([horizontalPattern, horizontalPattern], 2, 2);
		compare(await structureRender({
			...structureBase, matchBy: 'structure', placementMode: 'reuse', reference: texture(4, 2, repeatedPattern), iterations: 0,
		}), repeatedPattern, 'reusable structural matching repeats the correct pattern');

		// 【透明度の位置関係も領域ごとに比較し、透明な画像片を黒として扱わない】
		// 同じ平均RGBAを持つ半透明・透明の縦横模様で、alphaの構造と元のRGBAの保持を確認する。
		const verticalAlphaPattern = [gray(1, 0.25), gray(0, 0), gray(1, 0.25), gray(0, 0)];
		const horizontalAlphaPattern = [gray(1, 0.25), gray(1, 0.25), gray(0, 0), gray(0, 0)];
		const alphaStructurePixels = cellImage([verticalAlphaPattern, horizontalAlphaPattern], 2, 2);
		const alphaStructureExpected = cellImage([horizontalAlphaPattern, verticalAlphaPattern], 2, 2);
		for (const placementMode of ['oneToOne', 'reuse'] as const) {
			compare(await structureRender({
				...structureBase, input: texture(4, 2, alphaStructurePixels), reference: texture(4, 2, alphaStructureExpected), matchBy: 'structure', placementMode,
			}), alphaStructureExpected, `${placementMode} structure matches translucent and transparent regions`);
		}

		// 【構造を比較する端セルでも画面外の反射部分を解析・描画へ含める】
		// 平均色が同じな二つの欠けたセルに対し、反射で補った左右の構造を入れ替える。
		const structuralEdgePixels = rowImage([1, 0, 0, 0, 0, 1]);
		const structuralEdgeExpected = rowImage([0, 1, 1, 1, 1, 0]);
		for (const placementMode of ['oneToOne', 'reuse'] as const) {
			for (const structureGrid of ['2x2', '4x4'] as const) {
				compare(await edgeRender({
					...edgeBase, input: texture(6, 2, structuralEdgePixels), reference: texture(6, 2, structuralEdgeExpected), matchBy: 'structure', placementMode, structureGrid,
				}), structuralEdgeExpected, `${placementMode} ${structureGrid} compares mirrored edge structures`);
			}
		}
		const scaledDetailRender = createEffect(16, 8);
		const scaledDetailExpected = Array.from({ length: 8 }, (_, y) => Array.from({ length: 16 }, (_, x) => detailExpected[Math.floor(y / 2) * 8 + Math.floor(x / 2)])).flat();
		compare(await scaledDetailRender({ ...detailBase, structureGrid: '4x4', placementMode: 'reuse' }), scaledDetailExpected, 'structural matching is resolution independent');
		compare(await structureRender({ ...structureBase, matchBy: 'structure', input: constantInput }), Array.from({ length: 8 }, () => [0.25, 0.125, 0.5, 0.5] as Color), 'structural matching supports constant inputs without double premultiplication');

		// 【構造比較の領域数をGPUの統計buffer容量へ含める】
		// 全体平均なら収まる格子でも4×4の特徴量で上限を超えたら、領域を間引かず拒否する。
		const statisticsLimit = Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize);
		const oversizedStructureFrequency = 2 * Math.ceil(Math.sqrt(statisticsLimit / 512) / 2) + 2;
		let structureRejected = false;
		try {
			await render({ ...base, matchBy: 'structure', structureGrid: '4x4', frequency: [oversizedStructureFrequency, oversizedStructureFrequency] });
		} catch (error) { structureRejected = error instanceof Error && error.message.includes('GPU resource limits'); }
		if (!structureRejected) throw new Error('Oversized structural statistics were not rejected');
		checks.push('structural feature storage limits are enforced');

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
