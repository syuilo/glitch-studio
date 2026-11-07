import definition from '../../src/fx/colorRamp/_def_.ts';
import implementation from '../../src/fx/colorRamp/_impl_.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import { constantShaderInput, textureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import { COLOR_RAMP_INTERPOLATIONS, createDefaultColorRamp, evaluatePreparedColorRamp, prepareColorRamp } from '@gs/shared/color-ramp.ts';
import type { ColorRamp } from '@gs/shared/color-ramp.ts';
import type { ShaderInput } from '@gs/shared/gpu/shader-input.ts';

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	device.pushErrorScope('validation');
	const resolution = { width: 17, height: 1 };
	const wgpu = { device, intermediateTextureFormat: 'rgba8unorm' as const, enable32bitDataTextures: false, defaultVertexShaderModule: device.createShaderModule({ code: vertexCode }) };
	const output = implementation.outputTextureFactories.output({ wgpu, resolution });
	const copyTarget = device.createTexture({ size: resolution, format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
	const reader = device.createRenderPipeline({ layout: 'auto', vertex: { module: wgpu.defaultVertexShaderModule }, fragment: { module: device.createShaderModule({ code: `@group(0) @binding(0) var image: texture_2d<f32>;
@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f { return textureLoad(image, vec2i(p.xy), 0); }` }), targets: [{ format: 'rgba8unorm' }] } });
	const readGroup = device.createBindGroup({ layout: reader.getBindGroupLayout(0), entries: [{ binding: 0, resource: output.createView() }] });
	const buffer = device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
	const scalarTexture = device.createTexture({ size: resolution, format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
	const pixels = new Uint8Array(resolution.width * 4);
	const positions = Array.from({ length: resolution.width }, (_, index) => Math.round(index / 16 * 255) / 255);
	positions.forEach((value, index) => { pixels[index * 4] = Math.round(value * 255); pixels[index * 4 + 3] = 255; });
	device.queue.writeTexture({ texture: scalarTexture }, pixels, { bytesPerRow: resolution.width * 4 }, resolution);
	const input = textureShaderInput(scalarTexture, { fitMode: 'stretch', wrapMode: 'clamp', filterMode: 'nearest' });
	const defaults = { ramp: createDefaultColorRamp(), input: constantShaderInput('scalar', 0) };
	const effect = implementation.init({ wgpu, resolution, params: defaults, reportStatus: () => {}, fallbackTexture: output });
	const checks: string[] = [];
	async function compare(ramp: ColorRamp, shaderInput: ShaderInput, coordinates: number[], label: string) {
		const commandEncoder = device.createCommandEncoder();
		effect.render({ params: { ramp, input: shaderInput }, commandEncoder, time: 0, timeDelta: 0, pointerPosition: { x: 0, y: 0 }, pointerVector: { x: 0, y: 0 },
			outputDataMap: { output: { texture: output, textureView: output.createView(), previousFrameTexture: null, previousFrameTextureView: null } },
			createPassEncoder: (encoder, descriptor) => encoder.beginRenderPass(descriptor), createComputePassEncoder: encoder => encoder.beginComputePass(),
			createPassEncoderFor: (encoder, view) => encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }] }),
		});
		const pass = commandEncoder.beginRenderPass({ colorAttachments: [{ view: copyTarget.createView(), loadOp: 'clear', storeOp: 'store' }] });
		pass.setPipeline(reader); pass.setBindGroup(0, readGroup); pass.draw(3); pass.end();
		commandEncoder.copyTextureToBuffer({ texture: copyTarget }, { buffer, bytesPerRow: 256 }, resolution);
		device.queue.submit([commandEncoder.finish()]);
		await buffer.mapAsync(GPUMapMode.READ);
		try {
			const actual = new Uint8Array(buffer.getMappedRange());
			const prepared = prepareColorRamp(ramp);
			coordinates.forEach((value, index) => evaluatePreparedColorRamp(prepared, value).forEach((component, channel) => {
				if (Math.abs(actual[index * 4 + channel] - component * 255) > 1.5) throw new Error(`${label}: pixel ${index} channel ${channel}: ${actual[index * 4 + channel]} != ${component * 255}`);
			}));
		} finally { buffer.unmap(); }
		const error = await device.popErrorScope();
		device.pushErrorScope('validation');
		if (error != null) throw new Error(error.message);
		checks.push(label);
	}
	try {
		for (const colorSpace of ['srgb', 'linearSrgb', 'oklab', 'oklch'] as const) for (const interpolation of COLOR_RAMP_INTERPOLATIONS) {
			const ramp: ColorRamp = { colorSpace, interpolation, stops: [
				{ id: 'start', position: 0, color: [1, 0, 0, 0.8] }, { id: 'middle', position: 0.5, color: [0, 1, 0, 0.3] }, { id: 'end', position: 1, color: [0, 0, 1, 0] },
			] };
			await compare(ramp, input, positions, `${colorSpace}/${interpolation}/texture`);
			await compare(ramp, constantShaderInput('scalar', 0.25), positions.map(() => 0.25), `${colorSpace}/${interpolation}/uniform`);
		}
		// 全経路で、alphaの0と微小値・無彩色の区間ごとの色相補完・同色相の一周を
		// 実際のWGSLで評価する。alpha乗算後のCから無彩色を判定すると透明な有彩色で失敗する。
		const hueCases: { label: string; colors: ColorRamp['stops'][number]['color'][] }[] = [
			{ label: 'hue wrap', colors: [[0.7090230868, 0.4824507734, 0.5882349397, 1], [0.7300260394, 0.4811885705, 0.5173839076, 1]] },
			{ label: 'transparent hue', colors: [[1, 0, 0, 1], [0, 0, 1, 0]] },
			{ label: 'tiny alpha hue', colors: [[1, 0, 0, 1], [0, 0, 1, 1e-6]] },
			{ label: 'transparent start', colors: [[0, 0, 1, 0], [1, 0, 0, 1]] },
			{ label: 'achromatic segments', colors: [[1, 0, 0, 1], [0.5, 0.5, 0.5, 1], [0, 0, 1, 1]] },
			{ label: 'grayscale', colors: [[0, 0, 0, 1], [1, 1, 1, 1]] },
			{ label: 'same hue', colors: [[1, 0, 0, 1], [1, 0, 0, 1]] },
			{ label: 'fully transparent', colors: [[1, 0, 0, 0], [0, 0, 1, 0]] },
		];
		for (const hueInterpolation of ['shorter', 'longer', 'increasing', 'decreasing'] as const) for (const { label, colors } of hueCases) {
			const ramp: ColorRamp = { interpolation: 'linear', colorSpace: 'oklch', hueInterpolation, stops: colors.map((color, index) => ({ id: `stop-${index}`, position: index / (colors.length - 1), color })) };
			await compare(ramp, input, positions, `oklch/${hueInterpolation}/${label}`);
		}
		const ramp = createDefaultColorRamp();
		for (const value of [-1, 0, 0.5, 1, 2]) await compare(ramp, constantShaderInput('scalar', value), positions.map(() => value), `extension ${value}`);
		ramp.stops.push({ id: 'jump', position: 0.5, color: [0, 0, 1, 1] }, { id: 'lastJump', position: 0.5, color: [1, 0, 0, 1] });
		await compare(ramp, constantShaderInput('scalar', 0.5), positions.map(() => 0.5), 'duplicate stop boundary');
		ramp.stops = [ramp.stops[2]];
		await compare(ramp, input, positions, 'buffer shrink and single stop');
		ramp.stops = Array.from({ length: 100 }, (_, index) => ({ id: `stop-${index}`, position: index / 99, color: [index / 99, 0.25, 1 - index / 99, 1] }));
		await compare(ramp, input, positions, 'buffer growth without pipeline replacement');
		return { checks };
	} finally {
		effect.dispose(); buffer.destroy(); output.destroy(); copyTarget.destroy(); scalarTexture.destroy(); device.destroy();
	}
}
