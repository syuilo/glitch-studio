import definition from '../../src/fx/cellSort/_def_.ts';
import implementation from '../../src/fx/cellSort/_impl_.ts';
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
		direction: 'horizontal', order: 'ascending', sortBy: 'luminance', customSortKey: constantShaderInput('scalar', 0),
		thresholdMin: 0, thresholdMax: 1, samplesPerCell: 16, flattenMovedCells: false,
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
		const sourceRow = [0.75, 1, 0.125, 0.375, 0.5, 0.625, 0.25, 0];
		const ascending = [0.25, 0, 0.125, 0.375, 0.5, 0.625, 0.75, 1];
		const input = texture(8, 2, rowImage(sourceRow));
		const render = createEffect(8, 2);

		// 【画像片の細部を保持して水平・垂直に交換する】
		// セル内まで画素ソートする誤りや、方向変更で行と列の対応が残る不具合を検出する。
		compare(await render({ input }), rowImage(ascending), 'horizontal ascending preserves fragments');
		compare(await render({ input, order: 'descending' }), rowImage([0.75, 1, 0.5, 0.625, 0.125, 0.375, 0.25, 0]), 'horizontal descending');
		const verticalInput = texture(2, 8, sourceRow.flatMap(value => [gray(value), gray(value)]));
		const verticalRender = createEffect(2, 8);
		compare(await verticalRender({ input: verticalInput, direction: 'vertical', phase: [0.5, 0] }), ascending.flatMap(value => [gray(value), gray(value)]), 'vertical ascending from top to bottom');
		const squareInput = texture(8, 8, sourceRow.flatMap(value => Array.from({ length: 8 }, () => gray(value))));
		const squareRender = createEffect(8, 8);
		compare(await squareRender({ input: squareInput, direction: 'vertical', phase: [0, 0] }), ascending.flatMap(value => Array.from({ length: 8 }, () => gray(value))), 'vertical switch on square grid');
		compare(await squareRender({ input: squareInput }), sourceRow.flatMap(value => Array.from({ length: 8 }, () => gray(value))), 'horizontal after vertical retains each row');

		// 【実際に移動したセルだけを移動元の平均RGBAにする】
		// ソート対象でも同じ位置に残るセルや、単一セルを平坦化してしまわないことを確認する。
		compare(await render({ input, flattenMovedCells: true }), rowImage([0.125, 0.125, 0.125, 0.375, 0.5, 0.625, 0.875, 0.875]), 'only moved cells use source averages');
		compare(await render({ input, frequency: [1, 1], phase: [0.5, 0.5], flattenMovedCells: true }), rowImage(sourceRow), 'single cell preserves original detail');
		compare(await render({ input }), rowImage(ascending), 'grid grows again after single cell');

		// 【workgroup境界をまたぐ非2冪の行を最後まで整列する】
		// 小さな格子だけでは検出できないdispatchの端数と、複数段の参照bufferの選択を確認する。
		const longRow = Array.from({ length: 67 }, (_, index) => (66 - index) / 128).flatMap(value => [value, value]);
		const longInput = texture(134, 2, rowImage(longRow));
		const longRender = createEffect(134, 2);
		compare(await longRender({ input: longInput, frequency: [67, 67], phase: [0.5, 0.5] }), rowImage([...longRow].reverse()), 'non power of two sorting across workgroups');

		// 【閾値の範囲外のセルを固定し、前後の区間を分離する】
		// 長さ5の非2冪の行を用い、mergeの端処理と孤立した境界を同時に確認する。
		const separatedRow = [0.75, 0.875, 0.25, 0.375, 1, 1, 0.5, 0.625, 0.125, 0];
		const separatedInput = texture(10, 2, rowImage(separatedRow));
		const separatedRender = createEffect(10, 2);
		compare(await separatedRender({ input: separatedInput, frequency: [5, 5], phase: [0.5, 0.5], thresholdMax: 0.9 }), rowImage([0.25, 0.375, 0.75, 0.875, 1, 1, 0.125, 0, 0.5, 0.625]), 'out of range cells separate sort segments');
		const tiedKeys = texture(5, 1, [0.5, 0.25, 0.25, 0.75, 0.5].map(value => [value, 0, 0, 0]));
		const customBase: Partial<Parameters> = { input: separatedInput, frequency: [5, 5], phase: [0.5, 0.5], sortBy: 'custom', customSortKey: tiedKeys };
		compare(await separatedRender(customBase), rowImage([0.25, 0.375, 1, 1, 0.75, 0.875, 0.125, 0, 0.5, 0.625]), 'stable equal keys ascending with scalar field');
		compare(await separatedRender({ ...customBase, order: 'descending' }), rowImage([0.5, 0.625, 0.75, 0.875, 0.125, 0, 0.25, 0.375, 1, 1]), 'stable equal keys descending');
		const boundaryKeys = texture(5, 1, [1, 0.25, 0.5, 0.75, 0].map(value => [value, 0, 0, 0]));
		compare(await separatedRender({ ...customBase, customSortKey: boundaryKeys, thresholdMin: 0.75, thresholdMax: 0.25, order: 'descending' }), rowImage([0.75, 0.875, 0.5, 0.625, 1, 1, 0.25, 0.375, 0.125, 0]), 'inclusive and reversed threshold bounds');
		compare(await separatedRender({ ...customBase, customSortKey: constantShaderInput('scalar', NaN), flattenMovedCells: true }), rowImage(separatedRow), 'invalid scalar keys remain fixed');

		// 【端セルは本来の寸法を保ち、解析・描画とも描画領域で反射する】
		// 幅4のセルが左右で1画素ずつ欠ける入力。期待値は既知の反射画素列から指定する。
		const edgeRow = [0.75, 0.5, 0.25, 0.125, 0, 0.0625];
		const edgeInput = texture(6, 2, rowImage(edgeRow), { wrapMode: 'repeat' });
		const edgeRender = createEffect(6, 2);
		const edgeBase: Partial<Parameters> = { input: edgeInput, frequency: [1.5, 3] };
		compare(await edgeRender(edgeBase), rowImage([0, 0.0625, 0.0625, 0.75, 0.75, 0.5]), 'partial cells mirror without stretching');
		compare(await edgeRender({ ...edgeBase, flattenMovedCells: true }), rowImage([0.0625, 0.0625, 0.0625, 0.5625, 0.5625, 0.5625]), 'averages include mirrored parts of edge cells');
		compare(await edgeRender({ ...edgeBase, thresholdMax: 0.55 }), rowImage(edgeRow), 'threshold uses mirrored full cell average');
		// 【Phaseで欠け方が変わってもセルの寸法と+Y方向の定義を保つ】
		// Xの正方向とYの負方向で同じ上・左基準の格子を作り、画像座標との符号変換を確認する。
		const shiftedEdge = [0, 0.0625, 0.5, 0.75, 0.75, 0.5];
		compare(await edgeRender({ ...edgeBase, phase: [0.25, 0.5] }), rowImage(shiftedEdge), 'fractional phase changes edge coverage');
		const verticalEdgeInput = texture(2, 6, edgeRow.flatMap(value => [gray(value), gray(value)]));
		const verticalEdgeRender = createEffect(2, 6);
		compare(await verticalEdgeRender({ input: verticalEdgeInput, frequency: [3, 1.5], phase: [0.5, -0.25], direction: 'vertical' }), shiftedEdge.flatMap(value => [gray(value), gray(value)]), 'vertical phase follows positive upward grid coordinates');
		const repeatingKeys = texture(2, 1, [[0, 0, 0, 0], [1, 0, 0, 0]]);
		compare(await edgeRender({ ...edgeBase, frequency: [1 / 3, 3], sortBy: 'custom', customSortKey: repeatingKeys, samplesPerCell: 1 }), rowImage([...edgeRow].reverse()), 'negative coordinates and multiple mirror periods');
		const fittedInput = texture(2, 2, rowImage([0.75, 0.25]), { fitMode: 'contain', wrapMode: 'transparent' });
		compare(await edgeRender({ ...edgeBase, input: fittedInput }), Array.from({ length: 12 }, () => gray(0, 0)), 'mirror boundary follows canvas instead of fitted texture');
		compare(await edgeRender({ ...edgeBase, input: fittedInput, flattenMovedCells: true }), Array.from({ length: 2 }, () => [gray(0.25, 0.25), gray(0.25, 0.25), gray(0.25, 0.25), gray(0.75, 0.25), gray(0.75, 0.25), gray(0.75, 0.25)]).flat(), 'fitted canvas averages include transparent margins');

		// 【透明度を輝度と混同せず、完全透明セルは区間の境界にする】
		// 半透明の白を不透明な灰色より暗いと判定したり、平均RGBAを二重乗算する実装を防ぐ。
		const alphaPixels = [gray(1, 0.25), gray(0.75, 1), gray(0, 0), gray(0.5, 0.5), gray(0.25, 1)];
		const alphaInput = texture(5, 1, alphaPixels);
		const alphaRender = createEffect(5, 1);
		const alphaBase: Partial<Parameters> = { input: alphaInput, frequency: [5, 5], phase: [0.5, 0.5] };
		compare(await alphaRender({ ...alphaBase, flattenMovedCells: true }), [alphaPixels[1], alphaPixels[0], alphaPixels[2], alphaPixels[4], alphaPixels[3]], 'alpha aware brightness and transparent boundary');
		compare(await alphaRender({ ...alphaBase, sortBy: 'alpha' }), alphaPixels, 'alpha sorts separately from visible color');
		compare(await alphaRender({ ...alphaBase, input: constantShaderInput('color', [0.5, 0.25, 1, 0.5]), flattenMovedCells: true }), Array.from({ length: 5 }, () => [0.25, 0.125, 0.5, 0.5] as Color), 'constant color remains premultiplied once');
		// 【セル内の透明部分を含む平均RGBAと、可視色のキーを分離する】
		// 平均alphaの低い白が暗い灰色としてソートされる誤りと、平均色の二重乗算を防ぐ。
		const mixedAlphaInput = texture(4, 2, Array.from({ length: 2 }, () => [gray(1, 0.25), gray(0, 0), gray(0.5), gray(0.25)]).flat());
		const mixedAlphaRender = createEffect(4, 2);
		compare(await mixedAlphaRender({ input: mixedAlphaInput, frequency: [2, 2], flattenMovedCells: true }), Array.from({ length: 2 }, () => [gray(0.375), gray(0.375), gray(1, 0.125), gray(1, 0.125)]).flat(), 'premultiplied averages with mixed cell alpha');

		// 【RGBと彩度の基準を代表色から計算する】
		// 各方式で異なる比較結果になる色を使い、方式番号のずれや輝度への固定を検出する。
		const red: Color = [0.75, 0.125, 0.25, 1];
		const green: Color = [0.25, 0.5, 0.5, 1];
		const colorInput = texture(2, 1, [red, green]);
		const colorRender = createEffect(2, 1);
		for (const sortBy of ['red', 'green', 'blue', 'saturation'] as const) {
			compare(await colorRender({ input: colorInput, frequency: [2, 2], sortBy, order: sortBy === 'green' || sortBy === 'blue' ? 'descending' : 'ascending' }), [green, red], `${sortBy} representative color key`);
		}

		// 【解析数と出力解像度・Size Reference・Phaseを独立に扱う】
		// 画像を2倍で描画しても同じ画像片が並び、整数周期のPhaseで格子が変わらないことを確認する。
		const scaledRender = createEffect(16, 4);
		compare(await scaledRender({ input }), rowImage(ascending.flatMap(value => [value, value]), 4), 'resolution independent grid and analysis');
		for (const sizeReference of ['width', 'height', 'shortSide', 'longSide'] as const) {
			compare(await render({ input, sizeReference, frequency: sizeReference === 'height' || sizeReference === 'shortSide' ? [1, 1] : [4, 4] }), rowImage(ascending), `${sizeReference} size reference`);
		}
		compare(await render({ input, phase: [-2, 3.5] }), rowImage(ascending), 'integer phase periods preserve grid');
		for (const samplesPerCell of [1, 3, 7, 16, 256]) {
			compare(await colorRender({ input: colorInput, frequency: [2, 2], sortBy: 'red', samplesPerCell }), [green, red], `${samplesPerCell} equal area samples`);
		}
		compare(await render({ input: constantShaderInput('color', [0, 0, 0, 1]), samplesPerCell: NaN, phase: [NaN, NaN] }), rowImage(Array(8).fill(0)), 'nonfinite controls retain finite output');
		compare(await render({ input }, 100), rowImage(ascending), 'deterministic after parameter and input changes');

		// 【GPU上限を超える格子を実行前に拒否する】
		// エラーを出さずにセル数や精度を下げると、プレビューと書き出しで配置が変わるため拒否する。
		let rejected = false;
		try { await render({ frequency: [1e12, 1e12] }); } catch (error) { rejected = error instanceof Error && error.message.includes('GPU resource limits'); }
		if (!rejected) throw new Error('Oversized grid was not rejected');
		checks.push('oversized cell grids are rejected');
		return { checks };
	} finally {
		for (const dispose of disposables.reverse()) dispose();
		device.destroy();
	}
}
