import definition from '../../src/fx/scalarRangeLimit/_def_.ts';
import implementation from '../../src/fx/scalarRangeLimit/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { ShaderInputSampling } from '@gs/shared/gpu/shader-input.ts';
import type { RuntimeEffectParameters } from '../../src/effect-implementation.ts';

type Parameters = RuntimeEffectParameters<typeof definition.paramDefs>;

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
@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) f32 { return textureLoad(image, vec2i(p.xy), 0).r; }` }),
			targets: [{ format: 'r32float' }],
		},
	});
	const scalar = (value: number) => constantShaderInput('scalar', value);
	const defaults: Parameters = { input: scalar(0), min: scalar(0), max: scalar(1), mode: 'clamp' };
	const modes = definition.paramDefs.mode.dataType.options;
	const checks: string[] = [];
	const disposables: (() => void)[] = [];
	const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };

	function field(values: number[], sampling: Partial<ShaderInputSampling> = {}) {
		const texture = device.createTexture({ size: [values.length, 1], format: 'rgba16float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING });
		// alpha=0でもスカラー値を読み取る必要があり、色としての解釈を検出できる入力にする。
		const data = new Float16Array(values.flatMap(value => [value, 0, 0, 0]));
		device.queue.writeTexture({ texture }, data, { bytesPerRow: values.length * 8 }, [values.length, 1]);
		disposables.push(() => texture.destroy());
		return textureShaderInput(texture, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest', ...sampling });
	}

	function createEffect(width: number, height: number, precise: boolean) {
		const resolution = { width, height };
		const wgpu = { device, defaultVertexShaderModule: vertex, enable32bitDataTextures: precise };
		const output = implementation.outputTextureFactories.output({ wgpu, resolution });
		assert(output.format === (precise ? 'r32float' : 'r16float'), 'output data precision');
		const effect = implementation.init({ wgpu, resolution, params: defaults, fallbackTexture: output, reportStatus: () => {} });
		const copyTarget = device.createTexture({ size: resolution, format: 'r32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
		const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
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
			pass.setPipeline(reader);
			pass.setBindGroup(0, readGroup);
			pass.draw(3);
			pass.end();
			commandEncoder.copyTextureToBuffer({ texture: copyTarget }, { buffer, bytesPerRow }, resolution);
			device.queue.submit([commandEncoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			const pixels = new Float32Array(width * height);
			try {
				const mapped = new Float32Array(buffer.getMappedRange());
				for (let y = 0; y < height; y++) pixels.set(mapped.subarray(y * bytesPerRow / 4, y * bytesPerRow / 4 + width), y * width);
			} finally { buffer.unmap(); }
			const error = await device.popErrorScope();
			device.pushErrorScope('validation');
			if (error != null) throw new Error(error.message);
			assert(pixels.every(Number.isFinite), 'finite scalar output');
			return pixels;
		};
	}

	try {
		assert(definition.primaryInputParameter === 'input' && definition.primaryOutput === 'output' && definition.outputDefs.output.dataType.kind === 'scalar', 'scalar input output contract');
		assert(definition.resolutionInputParameters.join(',') === 'input,min,max', 'all scalar fields contribute to static resolution');
		assert(modes.join(',') === 'clamp,wrap,pingPong' && !definition.dependsOnRenderHistory, 'modes and history contract');
		for (const parameter of ['input', 'min', 'max'] as const) assert(definition.paramDefs[parameter].canNode, `${parameter} accepts node inputs`);
		for (const [parameter, expected] of [['input', 0], ['min', 0], ['max', 1], ['mode', 'clamp']] as const) {
			assert(definition.paramDefs[parameter].defaultValue.value === expected, `${parameter} default value`);
		}
		checks.push('scalar ports defaults modes and resolution contract');

		for (const precise of [false, true]) {
			const label = precise ? '32bit' : '16bit';
			const compare = (actual: Float32Array, expected: number[], message: string) => {
				assert(actual.length === expected.length, `${message} dimensions`);
				actual.forEach((value, index) => assert(Math.abs(value - expected[index]) <= (precise ? 1e-6 : 1e-7 + Math.abs(expected[index]) * 0.001), `${label} ${message}/${index}: ${value} != ${expected[index]}`));
			};
			const sample = createEffect(1, 1, precise);
			compare(await sample(), [0], 'default output');

			// 【負値・複数周期・両端の扱い】既知の結果を並べ、実装と同じ式を期待値にせず
			// 切り捨て剰余の混入や、WrapとPing-pongの上限の取り違えを検出する。
			const unitCases = [
				[-4.25, 0, 0.75, 0.25], [-2, 0, 0, 0], [-1.25, 0, 0.75, 0.75],
				[-1, 0, 0, 1], [-0.25, 0, 0.75, 0.25], [0, 0, 0, 0],
				[0.25, 0.25, 0.25, 0.25], [1, 1, 0, 1], [1.25, 1, 0.25, 0.75],
				[2, 1, 0, 0], [3, 1, 0, 1], [4.25, 1, 0.25, 0.25],
			];
			for (const [input, ...expected] of unitCases) for (const [index, mode] of modes.entries()) {
				compare(await sample({ input: scalar(input), mode }), [expected[index]], `${mode} unit range at ${input}`);
			}
			checks.push(`${label} unit boundaries negative inputs and repeated periods`);

			// 【任意範囲と上下限の逆転】0〜1への固定や、下限を引き忘れる実装を防ぐ。
			// 逆転時も各方式で同じ範囲として評価されることを正負両方の範囲で確認する。
			const shiftedCases = [
				[2, 5, -5.5, 2, 3.5, 3.5], [2, 5, 1.25, 2, 4.25, 2.75],
				[2, 5, 3.25, 3.25, 3.25, 3.25], [2, 5, 5, 5, 2, 5],
				[2, 5, 5.75, 5, 2.75, 4.25], [2, 5, 8, 5, 2, 2], [2, 5, 11, 5, 2, 5],
				[-5, -2, -6, -5, -3, -4], [-5, -2, -2, -2, -5, -2], [-5, -2, 1, -2, -5, -5],
			];
			for (const [lower, upper, input, ...expected] of shiftedCases) for (const [min, max] of [[lower, upper], [upper, lower]]) {
				for (const [index, mode] of modes.entries()) compare(await sample({ input: scalar(input), min: scalar(min), max: scalar(max), mode }), [expected[index]], `${mode} shifted/reversed bounds`);
			}
			checks.push(`${label} arbitrary positive negative and reversed ranges`);

			// 【幅0と小さな有効範囲】上下限が一致する際の0除算を防ぎつつ、
			// epsilonで幅0と判定して小さな範囲まで潰してしまわないことを確認する。
			for (const mode of modes) for (const bound of [-2.5, 0, 3]) for (const input of [-10, bound, 10]) {
				compare(await sample({ input: scalar(input), min: scalar(bound), max: scalar(bound), mode }), [bound], `${mode} zero width`);
			}
			for (const mode of modes) compare(await sample({ input: scalar(1 / 8192), max: scalar(1 / 4096), mode }), [1 / 8192], `${mode} small in-range value`);
			for (const mode of ['wrap', 'pingPong'] as const) compare(await sample({ input: scalar(3 / 8192), max: scalar(1 / 4096), mode }), [1 / 8192], `${mode} small period`);
			checks.push(`${label} collapsed and small ranges`);

			// 【3つの入力場の交差・逆転・一致】上下限が画素ごとに異なり、alpha=0のデータでも
			// 各画素の範囲を使用することを検証する。全入力をuniformとして扱う誤りを防ぐ。
			const input = field([-1.25, 0.25, 2.25, 2, 5.75, -5.75, 8.5, 0.5]);
			const min = field([0, 1, 2, 2, 5, -5, 4, 0.5]);
			const max = field([1, 0, 1, 2, 2, -2, -2, 0.5]);
			const render = createEffect(8, 1, precise);
			const expectedFields = {
				clamp: [0, 0.25, 2, 2, 5, -5, 4, 0.5],
				wrap: [0.75, 0.25, 1.25, 2, 2.75, -2.75, 2.5, 0.5],
				pingPong: [0.75, 0.25, 1.75, 2, 4.25, -4.25, -0.5, 0.5],
			};
			for (const mode of modes) compare(await render({ input, min, max, mode }), expectedFields[mode], `${mode} scalar fields`);
			checks.push(`${label} per-pixel input and crossing bound fields`);

			// 【定数とテクスチャの切り替え】同一インスタンスで各入力の表現とModeを切り替え、
			// 古いuniformやbindingが残って新しい値に反映されない不具合を防ぐ。
			compare(await render({ input, mode: 'clamp' }), [0, 0.25, 1, 1, 1, 0, 1, 0.5], 'texture input with constant bounds');
			compare(await render({ input: scalar(2.25), min, max }), [1, 1, 2, 2, 2.25, -2, 2.25, 0.5], 'constant input with bound fields');
			compare(await render({ input: scalar(0.25) }), Array(8).fill(0.25), 'all constant inputs');
			compare(await render({ input, min, max, mode: 'wrap' }), expectedFields.wrap, 'restored fields and mode');
			checks.push(`${label} constant texture and mode updates`);

			// 【入力サンプリングと出力寸法】値の制限前に共通のfit・filterが適用されることを、
			// 入力と異なる縦横比・解像度の全画素で確認する。
			const resampled = createEffect(4, 2, precise);
			compare(await resampled({ input: field([0, 2]) }), [0, 0, 1, 1, 0, 0, 1, 1], 'nearest stretched field');
			compare(await resampled({ input: field([0, 2], { filterMode: 'linear' }) }), [0, 0.5, 1, 1, 0, 0.5, 1, 1], 'linear stretched field');
			checks.push(`${label} input sampling and rectangular output`);

			// 【時刻・描画履歴からの独立性】他のModeや値を描画した後でも、同じ入力は
			// 時刻によらず同じ結果となり、書き出し時の再現性を保つ。
			await render({ input: scalar(-10), mode: 'clamp' }, 10);
			compare(await render({ input, min, max, mode: 'pingPong' }, 100), expectedFields.pingPong, 'deterministic result');
			checks.push(`${label} deterministic output after other renders`);
		}
		return { checks };
	} finally {
		for (const dispose of disposables.reverse()) dispose();
		device.destroy();
	}
}
