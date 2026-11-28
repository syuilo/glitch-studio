import { createEffectInstance } from '@gs/subsystems_effect_renderer/create-effect-instance.ts';
import { nativeEffectProbe } from './native-effect-probe.ts';
import definition from '../../src/fx/burnTransition/_def_.ts';
import implementationNative from '../../src/fx/burnTransition/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { NativeParameterValues } from '../../src/multipass.ts';

const implementation = nativeEffectProbe(definition, implementationNative);

type Parameters = NativeParameterValues<typeof definition.paramDefs>;

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	device.pushErrorScope('validation');
	const vertex = device.createShaderModule({ code: vertexCode });
	const disposables: (() => void)[] = [];
	const checks: string[] = [];
	const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
	const near = (actual: number, expected: number, label: string, tolerance = 0.002) => assert(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);
	const equal = (actual: Float32Array, expected: Float32Array, label: string) => {
		assert(actual.length === expected.length, label);
		actual.forEach((value, index) => near(value, expected[index], label));
	};
	const scalar = (value: number) => constantShaderInput('scalar', value);
	// 未乗算の入力から期待する乗算済み色を明示する。HDR・負値・異なるalphaを含む。
	const inputA = constantShaderInput('color', [4, -2, 1, 0.5]);
	const inputB = constantShaderInput('color', [-2, 4, 0, 0.25]);
	const colorA = [2, -1, 0.5, 0.5];
	const colorB = [-0.5, 1, 0, 0.25];
	const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }] });
	const reader = device.createRenderPipeline({
		layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }), vertex: { module: vertex },
		fragment: { module: device.createShaderModule({ code: `@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(p.xy), 0); }` }), targets: [{ format: 'rgba32float' }] },
	});

	async function read(texture: GPUTexture) {
		const { width, height } = texture;
		const bytesPerRow = Math.ceil(width * 16 / 256) * 256;
		const target = device.createTexture({ size: [width, height], format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		try {
			const encoder = device.createCommandEncoder();
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
			pass.setPipeline(reader);
			pass.setBindGroup(0, device.createBindGroup({ layout, entries: [{ binding: 0, resource: texture.createView() }] }));
			pass.draw(3); pass.end();
			encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow }, [width, height]);
			device.queue.submit([encoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			const padded = new Float32Array(buffer.getMappedRange());
			const pixels = new Float32Array(width * height * 4);
			for (let row = 0; row < height; row++) pixels.set(padded.subarray(row * bytesPerRow / 4, row * bytesPerRow / 4 + width * 4), row * width * 4);
			buffer.unmap();
			return pixels;
		} finally { target.destroy(); buffer.destroy(); }
	}

	function textureInput(width: number, height: number, values: number[], scalarTexture = false) {
		const texture = device.createTexture({ size: [width, height], format: scalarTexture ? 'r16float' : 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		device.queue.writeTexture({ texture }, new Float16Array(values), { bytesPerRow: width * (scalarTexture ? 2 : 8) }, [width, height]);
		disposables.push(() => texture.destroy());
		return textureShaderInput(texture, { filterMode: 'nearest', fitMode: 'stretch', wrapMode: 'clamp' });
	}

	const outputPorts = ['output', 'mask', 'edge'] as const;
	type OutputPort = typeof outputPorts[number];

	function createEffect(width = 8, height = 4, precise = true) {
		const resolution = { width, height };
		const wgpu = { device, defaultVertexShaderModule: vertex, enable32bitDataTextures: precise };
		const defaults: Parameters = {
			inputA, inputB, progress: scalar(0.5), map: scalar(0.5),
			softness: 0.2, edgeWidth: 0.5, edgeIntensity: 2,
			edgeColor: constantShaderInput('color', [4, 2, -1, 0.5]),
			reverse: false, antiAlias: false,
		};
		const textures = new Map<OutputPort, GPUTexture>();
		const instance = implementation.place(wgpu, resolution);
		disposables.push(() => { instance.dispose(); for (const texture of textures.values()) texture.destroy(); });
		return async (overrides: Partial<Parameters> = {}, keys: readonly OutputPort[] = outputPorts, time = 0) => {
			const outputs = Object.fromEntries(keys.map(key => {
				let texture = textures.get(key);
				if (texture == null) {
					texture = implementation.createTexture(key, { wgpu, resolution });
					textures.set(key, texture);
				}
				if (key !== 'output') assert(texture.format === (precise ? 'r32float' : 'r16float'), 'scalar precision');
				return [key, texture];
			}));
			const encoder = device.createCommandEncoder();
			await instance.draw({
				params: { ...defaults, ...overrides }, commandEncoder: encoder, time, timeDelta: time,
				pointerPosition: { x: 0, y: 0 }, outputs,
			});
			device.queue.submit([encoder.finish()]);
			const pixels: Record<OutputPort, Float32Array> = { output: new Float32Array(), mask: new Float32Array(), edge: new Float32Array() };
			for (const key of keys) {
				const values = await read(textures.get(key)!);
				pixels[key] = key === 'output' ? values : Float32Array.from({ length: values.length / 4 }, (_, index) => values[index * 4]);
			}
			const error = await device.popErrorScope();
			device.pushErrorScope('validation');
			if (error != null) throw new Error(error.message);
			assert(pixels.output.every(Number.isFinite), 'finite color');
			assert(pixels.mask.every(value => Number.isFinite(value) && value >= 0 && value <= 1), 'bounded mask');
			assert(pixels.edge.every(value => Number.isFinite(value) && value >= 0 && value <= 1), 'bounded edge');
			return pixels;
		};
	}

	try {
		for (const precise of [false, true]) {
			const label = precise ? '32bit' : '16bit';
			const render = createEffect(8, 4, precise);
			// 【全幅・Map端点・反転によらず完全なA/Bを返す】
			// 幅が大きい発光や部分的な混合が、開始・終了画像へ残ることを防ぐ。
			for (const mapValue of [-1, 0.5, 2]) {
				for (const reverse of [false, true]) {
					for (const [softness, edgeWidth] of [[0, 0], [0, 0.5], [0.2, 0], [10, 10]]) {
						for (const progress of [-1, 0, 1, 2]) {
							const result = await render({ map: scalar(mapValue), reverse, softness, edgeWidth, progress: scalar(progress) });
							const endpoint = progress <= 0 ? 0 : 1;
							assert(result.mask.every(value => value === endpoint) && result.edge.every(value => value === 0), 'exact scalar endpoints');
							result.output.forEach((value, index) => near(value, (endpoint === 0 ? colorA : colorB)[index % 4], 'exact color endpoints', 0));
						}
					}
				}
			}
			checks.push(label + ' exact endpoints');

			// 【端点付近の発光と混合は連続して消える】
			// 定数Map=0/1は端点だけ強制する実装の不連続を特に検出しやすい。
			for (const mapValue of [0, 1]) {
				for (const [softness, edgeWidth] of [[0, 0.3], [0.2, 0], [0.2, 0.5], [100, 100]]) {
					for (const progress of [0.00001, 0.99999]) {
						const result = await render({ map: scalar(mapValue), softness, edgeWidth, progress: scalar(progress) });
						const expected = progress < 0.5 ? colorA : colorB;
						result.output.forEach((value, index) => near(value, expected[index % 4], 'continuous color endpoint'));
						assert(result.edge.every(value => value < 0.00001), 'continuous edge endpoint');
					}
				}
			}
			checks.push(label + ' continuous glow endpoints');

			// 【既知のMap区間で置換率と発光帯を独立に確認する】
			// 帯はA側だけにあり、半幅の位置が最大。HDR・alphaの乗算回数も検証する。
			const map = textureInput(8, 1, [0, 0.25, 0.5, 0.625, 0.75, 0.875, 1, 2], true);
			const result = await render({ map });
			const expectedMask = [1, 1, 0.5, 0, 0, 0, 0, 0];
			const expectedEdge = [0, 0, 0, 0.52734375, 1, 0.52734375, 0, 0];
			result.mask.forEach((mask, index) => {
				near(mask, expectedMask[index % 8], 'known replacement weight');
				near(result.edge[index], expectedEdge[index % 8], 'known edge profile');
				for (let channel = 0; channel < 4; channel++) {
					const base = colorA[channel] * (1 - mask) + colorB[channel] * mask;
					const glow = channel === 3 ? 0 : [2, 1, -0.5][channel] * expectedEdge[index % 8];
					near(result.output[index * 4 + channel], base + glow, 'premultiplied HDR glow');
				}
			});
			const reversed = await render({ map, reverse: true }, ['mask']);
			result.mask.forEach((mask, index) => near(reversed.mask[index], 1 - mask, 'reverse order'));
			checks.push(label + ' ordered erosion and edge profile');

			// 【3出力の7通りの組合せで同じ結果になる】
			// locationに穴があるpipelineや画像未確保の状態を実際に描画し、
			// Mask/Edge単独時の未使用出力参照を検出する。
			for (let selection = 1; selection < 8; selection++) {
				const keys = outputPorts.filter((_, index) => (selection & (1 << index)) !== 0);
				const isolated = await createEffect(8, 4, precise)({ map }, keys, 100);
				for (const key of keys) equal(isolated[key], result[key], 'independent ' + key);
			}
			const unused = await createEffectInstance({ effectSource: { type: 'nativeEffect', id: 'burnTransition' },
				definitions: {
					getNativeEffect: () => definition,
					getCustomShaderEffect() { throw new Error('Unexpected shader reference'); },
					getNodesEffect() { throw new Error('Unexpected graph reference'); },
				}, usedOutputPorts: new Set(), resolution: { width: 8, height: 4 } },
				{ device, defaultVertexShaderModule: vertex, enable32bitDataTextures: precise }, () => { throw new Error('Unused effect was initialized'); });
			try {
				unused.render({ time: 0, timeDelta: 0 }, device.createCommandEncoder());
				assert(unused.outputs.size === 0, 'no ports requested');
			} finally { unused.dispose(); }
			checks.push(label + ' independent lazy outputs');

			// 【完全透明なAから発光を作らず、透明Bへ切り替わった部分にも残さない】
			// 出力alphaを増やしたり、透明画素に非ゼロRGBを残す実装を防ぐ。
			const transparent = constantShaderInput('color', [9, -4, 3, 0]);
			const transparentA = await render({ map, inputA: transparent });
			transparentA.mask.forEach((mask, index) => {
				for (let channel = 0; channel < 4; channel++) near(transparentA.output[index * 4 + channel], colorB[channel] * mask, 'transparent A has no glow');
			});
			const transparentB = await render({ map, inputB: transparent });
			for (let channel = 0; channel < 4; channel++) near(transparentB.output[channel], 0, 'fully replaced transparent B', 0);
			const bothTransparent = await render({ map, inputA: transparent, inputB: transparent });
			assert(bothTransparent.output.every(value => value === 0), 'both transparent remain empty');
			const noIntensity = await render({ map, edgeIntensity: 0 });
			const noEdgeColor = await render({ map, edgeColor: transparent });
			equal(noIntensity.output, noEdgeColor.output, 'edge color alpha controls emission');
			equal(noIntensity.edge, result.edge, 'edge output independent of intensity');
			equal(transparentA.edge, result.edge, 'edge output independent of image alpha');
			checks.push(label + ' transparent emission');
		}

		// 【画像・発光色・進捗のテクスチャ入力と決定性】
		// 定数入力専用の実装や、データに色変換を適用する誤りを検出する。
		const render = createEffect();
		const progress = textureInput(8, 1, [0, 0, 0.5, 0.5, 0.5, 0.5, 1, 1], true);
		const colored = await render({
			inputA: textureInput(1, 1, colorA), inputB: textureInput(1, 1, colorB), progress,
			map: scalar(0.75), edgeColor: textureInput(1, 1, [2, 1, -0.5, 0.5]),
		});
		for (let index = 0; index < colored.mask.length; index++) {
			const x = index % 8;
			const expected = x < 2 ? colorA : x >= 6 ? colorB : [4, 0, 0, 0.5];
			for (let channel = 0; channel < 4; channel++) near(colored.output[index * 4 + channel], expected[channel], 'texture inputs');
		}
		const repeated = await render({ map: scalar(0.75) }, outputPorts, 200);
		const initial = await render({ map: scalar(0.75) });
		equal(repeated.output, initial.output, 'time independent');
		checks.push('texture inputs and time independence');

		// 【AAはMapだけでなくProgress場の輪郭にも適用される】
		// 定数Mapに対する局所進捗でも、境界に中間値が必要になる。
		const progressRamp = textureInput(8, 1, [0.1, 0.2, 0.3, 0.49, 0.51, 0.7, 0.8, 0.9], true);
		const hard = await render({ progress: progressRamp, softness: 0, edgeWidth: 0, antiAlias: false }, ['mask']);
		const smooth = await render({ progress: progressRamp, softness: 0, edgeWidth: 0, antiAlias: true }, ['mask']);
		assert(hard.mask.every(value => value === 0 || value === 1), 'hard thresholds');
		assert(smooth.mask.some(value => value > 0 && value < 1), 'local progress antialias');
		checks.push('map and progress antialias');

		// 【同じMap位置なら出力解像度・縦横比によらず同じ侵食を得る】
		// AAを無効にして画素サイズの差を除き、入力Fitの違いを持ち込まない定数Mapで比較する。
		const reference = await render({ map: scalar(0.75) });
		for (const [width, height] of [[16, 8], [4, 8]]) {
			const resized = await createEffect(width, height)({ map: scalar(0.75) });
			resized.output.forEach((value, index) => near(value, reference.output[index % 4], 'resolution independent'));
		}
		checks.push('resolution and aspect independence');
		return { checks };
	} finally {
		for (const dispose of disposables.reverse()) dispose();
		device.destroy();
	}
}

