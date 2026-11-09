import definition from '../../src/fx/pixelSort/_def_.ts';
import implementation from '../../src/fx/pixelSort/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { RuntimeEffectParameters } from '../../src/effect-implementation.ts';

type Parameters = RuntimeEffectParameters<typeof definition.paramDefs>;
type Color = [number, number, number, number];
const gray = (value: number, alpha = 1): Color => [value * alpha, value * alpha, value * alpha, alpha];

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
		input: constantShaderInput('color', [0, 0, 0, 0]),
		thresholdMin: definition.paramDefs.thresholdMin.defaultValue.value,
		thresholdMax: definition.paramDefs.thresholdMax.defaultValue.value,
		direction: definition.paramDefs.direction.defaultValue.value,
		order: definition.paramDefs.order.defaultValue.value,
	};
	const checks: string[] = [];
	const disposables: (() => void)[] = [];
	function texture(width: number, height: number, pixels: Color[]) {
		if (pixels.length !== width * height) throw new Error('Invalid test image size');
		const image = device.createTexture({ size: [width, height], format: 'rgba16float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING });
		device.queue.writeTexture({ texture: image }, new Float16Array(pixels.flat()), { bytesPerRow: width * 8 }, [width, height]);
		disposables.push(() => image.destroy());
		return textureShaderInput(image, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest' });
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
		// 【既定値は暗部の0〜0.5を対象にする】
		// パラメータを指定しない状態で、旧既定値に近い範囲と降順の見た目を保つことを確認する。
		const defaultRow = [0.125, 0.5, 0.25, 1, 0.375, 0.0625, 0.25];
		const defaultInput = texture(7, 1, defaultRow.map(value => gray(value)));
		const render = createEffect(7, 1);
		const defaultExpected = [0.5, 0.25, 0.125, 1, 0.375, 0.25, 0.0625].map(value => gray(value));
		compare(await render({ input: defaultInput }), defaultExpected, 'default dark range and descending order');

		// 【上下限を含む中間範囲と、範囲外の固定境界】
		// 明部・暗部の二択では表現できなかった範囲を使い、上下限ちょうどの画素も交換する。
		const middleRow = [0.125, 0.75, 0.25, 0.5, 1, 0.625, 0.375];
		const middleInput = texture(7, 1, middleRow.map(value => gray(value)));
		const middleBase: Partial<Parameters> = { input: middleInput, thresholdMin: 0.25, thresholdMax: 0.75, order: 'ascending' };
		const middleExpected = [0.125, 0.25, 0.5, 0.75, 1, 0.375, 0.625].map(value => gray(value));
		compare(await render(middleBase), middleExpected, 'inclusive middle range with separated segments');
		compare(await render({ ...middleBase, order: 'descending' }), [0.125, 0.75, 0.5, 0.25, 1, 0.625, 0.375].map(value => gray(value)), 'descending middle range');
		compare(await render({ ...middleBase, thresholdMin: 0.75, thresholdMax: 0.25 }), middleExpected, 'reversed bounds select the same range');
		compare(await render({ ...middleBase, thresholdMin: 0.5, thresholdMax: 0.5 }), middleRow.map(value => gray(value)), 'equal bounds retain a singleton luminance');
		compare(await render({ ...middleBase, thresholdMin: 0.8, thresholdMax: 0.9 }), middleRow.map(value => gray(value)), 'all pixels outside the range remain fixed');
		compare(await render({ input: defaultInput, thresholdMin: NaN, thresholdMax: Infinity }), defaultExpected, 'nonfinite bounds fall back to defaults');

		// 【明部とHDR・負の輝度の範囲も直接指定できる】
		// 上下限の反転や0〜1へのclampが残っている場合に、既知の並びとの不一致で検出する。
		const brightRender = createEffect(6, 1);
		const brightInput = texture(6, 1, [1, 0.75, 0.25, 0.875, 0.75, 1].map(value => gray(value)));
		compare(await brightRender({ input: brightInput, thresholdMin: 0.75, thresholdMax: 1, order: 'ascending' }), [0.75, 1, 0.25, 0.75, 0.875, 1].map(value => gray(value)), 'bright range without threshold inversion');
		const hdrRender = createEffect(5, 1);
		const hdrInput = texture(5, 1, [1.5, -0.5, 2, 0, 1].map(value => gray(value)));
		compare(await hdrRender({ input: hdrInput, thresholdMin: -1, thresholdMax: 2, order: 'ascending' }), [-0.5, 0, 1, 1.5, 2].map(value => gray(value)), 'HDR and negative luminance are not clamped');

		// 【半透明の輝度を可視色から計算し、完全透明を境界にする】
		// 半透明の白を灰色より暗いと判定する誤りと、透明画素を越えて交換する誤りを検出する。
		const alphaPixels = [gray(1, 0.25), gray(0.5), gray(0, 0), gray(0.75, 0.5), gray(0.25)];
		const alphaRender = createEffect(5, 1);
		const alphaInput = texture(5, 1, alphaPixels);
		compare(await alphaRender({ input: alphaInput, thresholdMax: 1, order: 'ascending' }), [alphaPixels[1], alphaPixels[0], alphaPixels[2], alphaPixels[4], alphaPixels[3]], 'alpha aware luminance and transparent segment boundary');
		compare(await alphaRender({ input: alphaInput }), alphaPixels, 'partially transparent white is outside the default dark range');

		// 【同じ輝度はalphaが違っても元の順序を保つ】
		// alphaで画素を識別し、昇順・降順のどちらでも安定ソートすることを確認する。
		const tiedPixels = [gray(0.5, 0.25), gray(0.25), gray(0.5, 0.75), gray(0.25, 0.5), gray(0.5, 0.5)];
		const tiedInput = texture(5, 1, tiedPixels);
		compare(await alphaRender({ input: tiedInput, order: 'ascending' }), [tiedPixels[1], tiedPixels[3], tiedPixels[0], tiedPixels[2], tiedPixels[4]], 'equal visible luminance remains stable ascending');
		compare(await alphaRender({ input: tiedInput }), [tiedPixels[0], tiedPixels[2], tiedPixels[4], tiedPixels[1], tiedPixels[3]], 'equal visible luminance remains stable descending');

		// 【長方形の出力で縦横を切り替えても行列の参照を更新する】
		// 新しい上限がlineOffsetの領域を上書きしたり、以前の方向のbufferを参照する誤りを防ぐ。
		const matrix = [0.75, 0.5, 0.25, 0, 1, 0.625, 0.25, 0.75, 0.5, 0.5, 0.25, 1, 1, 0, 0.75];
		const matrixInput = texture(3, 5, matrix.map(value => gray(value)));
		const matrixRender = createEffect(3, 5);
		compare(await matrixRender({ input: matrixInput, thresholdMax: 1, direction: 'vertical', order: 'ascending' }), [0, 0, 0.25, 0.25, 0.25, 0.5, 0.5, 0.5, 0.625, 0.75, 0.75, 0.75, 1, 1, 1].map(value => gray(value)), 'vertical sorting after horizontal initialization');
		compare(await matrixRender({ input: matrixInput, thresholdMax: 1, order: 'ascending' }), [0.25, 0.5, 0.75, 0, 0.625, 1, 0.25, 0.5, 0.75, 0.25, 0.5, 1, 0, 0.75, 1].map(value => gray(value)), 'horizontal sorting after vertical render');
		const longRow = Array.from({ length: 67 }, (_, index) => (66 - index) / 128);
		const longInput = texture(67, 1, longRow.map(value => gray(value)));
		const longRender = createEffect(67, 1);
		compare(await longRender({ input: longInput, thresholdMax: 1, order: 'ascending' }), [...longRow].reverse().map(value => gray(value)), 'non power of two sorting across workgroups');

		// 【定数入力と再描画でもpremultiplied RGBAと履歴からの独立性を保つ】
		// 解析はalphaを除いても、出力色を二重乗算せず元のRGBAで返すことを確認する。
		compare(await render({ input: constantShaderInput('color', [0.5, 0.25, 1, 0.5]), thresholdMax: 1 }), Array.from({ length: 7 }, () => [0.25, 0.125, 0.5, 0.5] as Color), 'constant color remains premultiplied once');
		compare(await render({ input: defaultInput }, 100), defaultExpected, 'deterministic after input range and time changes');
		const singleRender = createEffect(1, 1);
		compare(await singleRender({ input: constantShaderInput('color', [1, 1, 1, 0.25]), thresholdMax: 1 }), [gray(1, 0.25)], 'single pixel bypasses merge');
		return { checks };
	} finally {
		for (const dispose of disposables.reverse()) dispose();
		device.destroy();
	}
}
