import vertex from '@gs/shared/gpu/vertex.wgsl';
import { createEffectInstance } from '@gs/subsystems_effect-new_renderer/create-effect-instance.ts';
import { nativeEffectDefinitions } from '../src/definitions.ts';
import { nativeEffectImplementations } from '../src/implementations.ts';

export function check(ok, reason) {
	if (!ok) throw new Error(reason);
}

export function near(actual, expected, reason, tolerance = 0.002) {
	check(Math.abs(actual - expected) <= tolerance, reason + ': ' + actual + ' != ' + expected);
}

export async function withGpu(run, measure = false, requiredFeatures = []) {
	const adapter = await navigator.gpu.requestAdapter();
	const features = measure && adapter.features.has('timestamp-query') ? [...requiredFeatures, 'timestamp-query'] : requiredFeatures;
	const device = await adapter.requestDevice({ requiredFeatures: features });
	device.pushErrorScope('validation');
	try {
		const gpu = { device, defaultVertexShaderModule: device.createShaderModule({ code: vertex }), enable32bitDataTextures: false };
		const definitions = { getNativeEffect: id => nativeEffectDefinitions[id] };
		const textures = [];
		const allocate = device.createTexture.bind(device);
		device.createTexture = descriptor => {
			const texture = allocate(descriptor);
			textures.push(texture);
			return texture;
		};
		let pipelineCount = 0;
		let bindGroupCount = 0;
		const createBindGroup = device.createBindGroup.bind(device);
		device.createBindGroup = descriptor => { bindGroupCount++; return createBindGroup(descriptor); };
		const layout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
			{ binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
		] });
		const reader = await device.createComputePipelineAsync({ layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }), compute: {
			module: device.createShaderModule({ code: `
@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> pixels: array<vec4f>;
@compute @workgroup_size(1) fn read(@builtin(global_invocation_id) id: vec3u) {
	pixels[id.y * textureDimensions(image).x + id.x] = textureLoad(image, id.xy, 0);
}` }),
		} });
		for (const method of ['createRenderPipeline', 'createRenderPipelineAsync', 'createComputePipeline', 'createComputePipelineAsync']) {
			const compile = device[method].bind(device);
			device[method] = descriptor => { pipelineCount++; return compile(descriptor); };
		}
		await run({
			gpu, textures, pipelines: () => pipelineCount, bindGroups: () => bindGroupCount,
			create: (effectSource, ports, inputs = {}, options = {}) => createEffectInstance({
				effectSource, definitions, resolution: { width: 4, height: 4 }, usedOutputPorts: new Set(ports), inputs, ...options,
			}, gpu, id => nativeEffectImplementations[id]),
			render(instance, frameOrDelta = 0) {
				const frame = typeof frameOrDelta === 'number' ? { time: 0, timeDelta: frameOrDelta } : frameOrDelta;
				const encoder = device.createCommandEncoder();
				const begin = encoder.beginRenderPass.bind(encoder);
				let passCount = 0;
				encoder.beginRenderPass = descriptor => { passCount++; return begin(descriptor); };
				instance.render(frame, encoder);
				device.queue.submit([encoder.finish()]);
				return passCount;
			},
			async read(texture) {
				const bytes = texture.width * texture.height * 16;
				const storage = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
				const staging = device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
				try {
					const encoder = device.createCommandEncoder();
					const pass = encoder.beginComputePass();
					pass.setPipeline(reader);
					pass.setBindGroup(0, device.createBindGroup({ layout, entries: [
						{ binding: 0, resource: texture.createView() }, { binding: 1, resource: { buffer: storage } },
					] }));
					pass.dispatchWorkgroups(texture.width, texture.height);
					pass.end();
					encoder.copyBufferToBuffer(storage, 0, staging, 0, bytes);
					device.queue.submit([encoder.finish()]);
					await staging.mapAsync(GPUMapMode.READ);
					return new Float32Array(staging.getMappedRange()).slice();
				} finally {
					staging.destroy();
					storage.destroy();
				}
			},
		});
		const error = await device.popErrorScope();
		if (error != null) throw new Error(error.message);
	} finally {
		device.destroy();
	}
}
