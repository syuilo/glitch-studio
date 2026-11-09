import definition from '../../src/fx/heightCaustics/_def_.ts';
import implementation from '../../src/fx/heightCaustics/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { RuntimeEffectParameters } from '../../src/effect-implementation.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';

type Parameters = RuntimeEffectParameters<typeof definition.paramDefs>;

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	device.pushErrorScope('validation');
	const vertex = device.createShaderModule({ code: vertexCode });
	const defaults = Object.fromEntries(Object.entries(definition.paramDefs).map(([name, parameter]) => [name, parameter.canNode === true ? constantShaderInput(parameter.dataType.kind, parameter.defaultValue.value) : parameter.defaultValue.value])) as Parameters;
	const owned: (() => void)[] = [];
	const checks: string[] = [];
	const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
	const near = (value: number, expected: number, tolerance: number, name: string) => assert(Number.isFinite(value) && Math.abs(value - expected) <= tolerance, `${name}: ${value} != ${expected}`);
	const scalar = (value: number) => constantShaderInput('scalar', value);
	const readLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }] });
	const reader = device.createRenderPipeline({
		layout: device.createPipelineLayout({ bindGroupLayouts: [readLayout] }), vertex: { module: vertex },
		fragment: { module: device.createShaderModule({ code: `@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(position.xy), 0); }` }), targets: [{ format: 'rgba32float' }] },
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
			pass.setBindGroup(0, device.createBindGroup({ layout: readLayout, entries: [{ binding: 0, resource: texture.createView() }] }));
			pass.draw(3); pass.end();
			encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow }, [width, height]);
			device.queue.submit([encoder.finish()]);
			await buffer.mapAsync(GPUMapMode.READ);
			const padded = new Float32Array(buffer.getMappedRange());
			const result = new Float32Array(width * height * 4);
			for (let y = 0; y < height; y++) result.set(padded.subarray(y * bytesPerRow / 4, y * bytesPerRow / 4 + width * 4), y * width * 4);
			buffer.unmap();
			return result;
		} finally { target.destroy(); buffer.destroy(); }
	}
	function createEffect(width: number, height: number, precise = false, allocateIrradiance = true) {
		const resolution = { width, height };
		const wgpu = { device, defaultVertexShaderModule: vertex, intermediateTextureFormat: INTERMEDIATE_TEXTURE_FORMAT, enable32bitDataTextures: precise };
		const output = implementation.outputTextureFactories.output({ wgpu, resolution });
		const irradiance = allocateIrradiance ? implementation.outputTextureFactories.irradiance({ wgpu, resolution }) : null;
		const instance = implementation.init({ wgpu, resolution, params: defaults, resources: {}, fallbackTexture: output, reportStatus: () => {} });
		owned.push(() => { instance.dispose(); output.destroy(); irradiance?.destroy(); });
		const outputData = (texture: GPUTexture) => ({ texture, textureView: texture.createView(), previousFrameTexture: null, previousFrameTextureView: null });
		return {
			async render(overrides: Partial<Parameters> = {}, usedOutputPorts?: Set<'output' | 'irradiance'>, time = 0) {
				const encoder = device.createCommandEncoder();
				instance.render({ params: { ...defaults, samples: 128, ...overrides }, commandEncoder: encoder, time, timeDelta: 16,
					pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 }, usedOutputPorts,
					outputDataMap: { output: outputData(output), ...(irradiance == null ? {} : { irradiance: outputData(irradiance) }) },
					createPassEncoder: (commandEncoder, descriptor) => commandEncoder.beginRenderPass(descriptor),
					createComputePassEncoder: commandEncoder => commandEncoder.beginComputePass(),
					createPassEncoderFor: (commandEncoder, view) => commandEncoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
				});
				device.queue.submit([encoder.finish()]);
				const error = await device.popErrorScope();
				device.pushErrorScope('validation');
				if (error != null) throw new Error(error.message);
				return { color: await read(output), irradiance: irradiance == null ? null : await read(irradiance) };
			},
		};
	}
	function field(width: number, height: number, value: (x: number, y: number) => number) {
		const texture = device.createTexture({ size: [width, height], format: 'r16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		const pixels = new Float16Array(Array.from({ length: width * height }, (_, index) => value((index % width + 0.5 - width / 2) / Math.max(width, height), (height / 2 - Math.floor(index / width) - 0.5) / Math.max(width, height))));
		device.queue.writeTexture({ texture }, pixels, { bytesPerRow: width * 2 }, [width, height]);
		owned.push(() => texture.destroy());
		return textureShaderInput(texture, { fitMode: 'stretch', filterMode: 'linear', wrapMode: 'clamp' });
	}
	const at = (pixels: Float32Array, width: number, x: number, y: number, channel = 0) => pixels[(y * width + x) * 4 + channel];
	const mean = (pixels: Float32Array) => pixels.reduce((sum, value, index) => sum + (index % 4 === 0 ? value : 0), 0) / (pixels.length / 4);
	const equal = (a: Float32Array, b: Float32Array, name: string) => assert(a.every((value, index) => value === b[index]), name);
	try {
		// 【平面の既知の照度と、リテラル・テクスチャ入力の一致】
		// 真上から強度1の光を当てた平面は照度1。黒い画像をそれらしく作るだけの実装を検出する。
		const effect = createEffect(128, 128);
		const flat = await effect.render({ softness: 0 });
		for (let index = 0; index < flat.irradiance!.length; index += 4) near(flat.irradiance![index], 1, 0.001, 'flat irradiance');
		equal(flat.color, (await effect.render({ height: field(32, 32, () => 0.1), softness: 0 })).color, 'constant texture and literal disagree');
		checks.push('uniform plane', 'constant texture and literal');

		// 【凸面で光が集まり、領域内の総光量は増えない】
		// 波長やぼかしによる疑似的な模様でなく、屈折による再分配になっていることを確認する。
		const lens = field(256, 256, (x, y) => 0.08 * Math.exp(-(x * x + y * y) / 0.02));
		const settings = { height: lens, heightScale: 1, receiverDistance: 0.3, ior: 1.5, softness: 0 };
		const focused = await effect.render(settings);
		assert(at(focused.irradiance!, 128, 64, 64) > 2, 'convex surface does not focus light');
		near(mean(focused.irradiance!), 1, 0.003, 'total flux');
		const dispersed = await effect.render({ ...settings, heightScale: -1 });
		assert(at(dispersed.irradiance!, 128, 64, 64) < 0.8, 'concave surface does not spread light');
		checks.push('convex focusing', 'concave spreading', 'flux conservation');

		// 【屈折率1と高さ倍率0で、法線による集光が消える】
		// 物理的な無効条件で一様な照度へ戻し、前の描画のhistogramも残さない。
		equal(flat.irradiance!, (await effect.render({ ...settings, ior: 1 })).irradiance!, 'IOR 1 must remove refraction');
		equal(flat.irradiance!, (await effect.render({ ...settings, heightScale: 0 })).irradiance!, 'zero height scale must remove refraction');
		checks.push('IOR 1', 'zero height scale and cleared accumulation');

		// 【光源方位と仰角を、横長・縦長でも同じ共通距離として扱う】
		// 30度の光源と屈折率1.5では受光位置が約0.1414ずれ、平面の照度はsin(30度)=0.5。
		for (const [width, height] of [[128, 64], [64, 128]]) {
			const rectangle = createEffect(width, height);
			const fromRight = await rectangle.render({ heightScale: 0, lightElevation: 1 / 12, lightAngle: 0, ior: 1.5, softness: 0 });
			near(at(fromRight.irradiance!, width, Math.floor(width / 2), Math.floor(height / 2)), 0.5, 0.002, 'oblique plane irradiance');
			near(at(fromRight.irradiance!, width, width - 3, Math.floor(height / 2)), 0, 0.001, 'right boundary must lose light');
			const fromAbove = await rectangle.render({ heightScale: 0, lightElevation: 1 / 12, lightAngle: 0.75, ior: 1.5, softness: 0 });
			near(at(fromAbove.irradiance!, width, Math.floor(width / 2), 2), 0, 0.001, 'top boundary must lose light');
			near(at(fromAbove.irradiance!, width, Math.floor(width / 2), 20), 0.5, 0.002, 'common Y displacement');
		}
		checks.push('light direction and elevation', 'landscape and portrait spatial units');

		// 【高さ場の勾配とぼかしも、縦横比に依存しない共通単位で評価する】
		// 同じ円形レンズを縦長と横長で描き、X/Yを交換した位置の照度を比較する。
		// 片軸だけ内部座標の倍率が残っていると、円形の集光が楕円へ変わってしまう。
		const radialHeight = (x: number, y: number) => 0.08 * Math.exp(-(x * x + y * y) / 0.02);
		const landscape = await createEffect(128, 64).render({ ...settings, height: field(256, 128, radialHeight), softness: 0.01 });
		const portrait = await createEffect(64, 128).render({ ...settings, height: field(128, 256, radialHeight), softness: 0.01 });
		for (const offset of [0, 3, 8, 14]) near(at(landscape.irradiance!, 128, 64 + offset, 31), at(portrait.irradiance!, 64, 32, 63 - offset), 0.02, 'radial irradiance across aspect ratios');
		checks.push('aspect-independent normals and softness');

		// 【ぼかし・光の色と透明度・強度を、それぞれの出力に適用する】
		// 照度を色のalphaで失わせず、カラーは乗算済みRGBAで返す。
		const softened = await effect.render({ ...settings, softness: 0.02 });
		assert(at(softened.irradiance!, 128, 64, 64) < at(focused.irradiance!, 128, 64, 64), 'softness does not reduce the focus peak');
		const tinted = await effect.render({ softness: 0, lightColor: [0.8, 0.4, 0.2, 0.5], lightIntensity: 2 });
		for (const [channel, value] of [0.8, 0.4, 0.2, 0.5].entries()) near(at(tinted.color, 128, 64, 64, channel), value, 0.001, 'premultiplied color');
		near(at(tinted.irradiance!, 128, 64, 64), 2, 0.001, 'color-independent irradiance');
		const transparent = await effect.render({ lightColor: [1, 1, 1, 0] });
		assert(transparent.color.every(value => value === 0), 'transparent light must have zero RGB');
		assert((await effect.render({ lightIntensity: 0 })).irradiance!.every((value, index) => index % 4 !== 0 || value === 0), 'zero intensity leaves stale light');
		checks.push('softness', 'premultiplied alpha', 'independent irradiance', 'zero intensity');

		// 【品質変更と時刻・描画順に依存しない】
		// 格子の再確保後も同じ値に戻り、乱数や履歴の蓄積を必要としない。
		await effect.render({ ...settings, samples: 64 });
		equal(focused.irradiance!, (await effect.render(settings, undefined, 200)).irradiance!, 'time or sample count change leaves stale state');
		const larger = await createEffect(256, 256).render({ ...settings, softness: 0.01 });
		const smaller = await effect.render({ ...settings, softness: 0.01 });
		near(at(larger.irradiance!, 256, 128, 128), at(smaller.irradiance!, 128, 64, 64), 0.1, 'output resolution independence');
		checks.push('quality changes', 'history independence', 'output resolution independence');

		// 【32bit照度・未使用の出力・小さな描画領域も実際に描画する】
		// optional featureを要求せず、照度だけのMRTと遅延出力なしのカラー描画を確認する。
		const precise = await createEffect(64, 64, true).render({ softness: 0 }, new Set(['irradiance']));
		near(at(precise.irradiance!, 64, 32, 32), 1, 0.0001, '32bit irradiance');
		const colorOnly = await createEffect(32, 16, false, false).render({ softness: 0, lightIntensity: 0.5 });
		near(at(colorOnly.color, 32, 16, 8), 0.5, 1 / 255, '16bit float color without lazy irradiance');
		const tiny = await createEffect(1, 1).render({ samples: NaN, heightScale: Infinity, ior: -1, softness: -1, lightElevation: 0 });
		assert(tiny.color.every(Number.isFinite) && tiny.irradiance!.every(Number.isFinite), 'degenerate settings produce non-finite pixels');
		const below = await effect.render({ height: scalar(-1), heightScale: 1, receiverDistance: 0.2 });
		near(mean(below.irradiance!), 0, 0, 'surface below receiving plane');
		checks.push('32bit data without optional features', 'irradiance-only and color-only outputs', 'degenerate settings', 'receiver plane clipping');

		const previewSize = 512;
		const waves = field(256, 256, (x, y) => 0.5 + 0.15 * Math.sin(24 * x + 2 * Math.sin(12 * y)) + 0.12 * Math.cos(28 * y + Math.sin(16 * x)) + 0.06 * Math.sin(47 * x + 35 * y));
		const previewResult = await createEffect(previewSize, previewSize).render({ height: waves, heightScale: 0.06, receiverDistance: 0.35, samples: 512, softness: 0.004 });
		const canvas = new OffscreenCanvas(previewSize, previewSize);
		const pixels = new Uint8ClampedArray(previewSize * previewSize * 4);
		for (let index = 0; index < pixels.length; index += 4) {
			const value = Math.round(255 * (1 - Math.exp(-previewResult.irradiance![index] * 0.6)));
			pixels.set([value, value, value, 255], index);
		}
		canvas.getContext('2d')!.putImageData(new ImageData(pixels, previewSize, previewSize), 0, 0);
		const blob = await canvas.convertToBlob({ type: 'image/png' });
		let preview = '';
		for (const value of new Uint8Array(await blob.arrayBuffer())) preview += String.fromCharCode(value);
		const error = await device.popErrorScope();
		if (error != null) throw new Error(error.message);
		return { checks, preview: btoa(preview) };
	} finally {
		for (const dispose of owned.reverse()) dispose();
		device.destroy();
	}
}
