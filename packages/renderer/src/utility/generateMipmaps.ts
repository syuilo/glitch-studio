type BeginRenderPass = (
	commandEncoder: GPUCommandEncoder,
	descriptor: GPURenderPassDescriptor,
) => GPURenderPassEncoder;

type MipLevelResources = {
	bindGroup: GPUBindGroup;
	passDescriptor: GPURenderPassDescriptor;
};

type DeviceResources = {
	module: GPUShaderModule;
	pipelines: Map<GPUTextureFormat, GPURenderPipeline>;
	sampler: GPUSampler;
	textures: WeakMap<GPUTexture, MipLevelResources[]>;
};

const resourcesByDevice = new WeakMap<GPUDevice, DeviceResources>();

const shaderCode = `
struct VertexOutput {
	@builtin(position) position: vec4f,
	@location(0) texcoord: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
	let positions = array(
		vec2f(-1.0, -1.0),
		vec2f(-1.0, 3.0),
		vec2f(3.0, -1.0),
	);
	let position = positions[vertexIndex];
	var output: VertexOutput;
	output.position = vec4f(position, 0.0, 1.0);
	output.texcoord = position * vec2f(0.5, -0.5) + vec2f(0.5);
	return output;
}

@group(0) @binding(0) var sourceSampler: sampler;
@group(0) @binding(1) var sourceTexture: texture_2d<f32>;

@fragment
fn fs(input: VertexOutput) -> @location(0) vec4f {
	return textureSample(sourceTexture, sourceSampler, input.texcoord);
}
`;

export function getMipLevelCount(width: number, height: number): number {
	return 1 + Math.floor(Math.log2(Math.max(width, height)));
}

function getDeviceResources(device: GPUDevice): DeviceResources {
	let resources = resourcesByDevice.get(device);
	if (resources != null) return resources;

	resources = {
		module: device.createShaderModule({
			label: 'mipmap generation shader',
			code: shaderCode,
		}),
		pipelines: new Map(),
		sampler: device.createSampler({
			magFilter: 'linear',
			minFilter: 'linear',
		}),
		textures: new WeakMap(),
	};
	resourcesByDevice.set(device, resources);
	return resources;
}

function getPipeline(device: GPUDevice, resources: DeviceResources, format: GPUTextureFormat): GPURenderPipeline {
	let pipeline = resources.pipelines.get(format);
	if (pipeline != null) return pipeline;

	pipeline = device.createRenderPipeline({
		label: `mipmap generation pipeline (${format})`,
		layout: 'auto',
		vertex: {
			module: resources.module,
			entryPoint: 'vs',
		},
		fragment: {
			module: resources.module,
			entryPoint: 'fs',
			targets: [{ format }],
		},
		primitive: { topology: 'triangle-list' },
	});
	resources.pipelines.set(format, pipeline);
	return pipeline;
}

function getTextureResources(device: GPUDevice, resources: DeviceResources, texture: GPUTexture): MipLevelResources[] {
	let levels = resources.textures.get(texture);
	if (levels != null) return levels;

	const pipeline = getPipeline(device, resources, texture.format);
	levels = [];
	for (let mipLevel = 1; mipLevel < texture.mipLevelCount; mipLevel++) {
		const sourceView = texture.createView({
			dimension: '2d',
			baseMipLevel: mipLevel - 1,
			mipLevelCount: 1,
		});
		const destinationView = texture.createView({
			dimension: '2d',
			baseMipLevel: mipLevel,
			mipLevelCount: 1,
		});
		levels.push({
			bindGroup: device.createBindGroup({
				layout: pipeline.getBindGroupLayout(0),
				entries: [
					{ binding: 0, resource: resources.sampler },
					{ binding: 1, resource: sourceView },
				],
			}),
			passDescriptor: {
				label: `mipmap generation pass ${mipLevel}`,
				colorAttachments: [{
					view: destinationView,
					clearValue: [0, 0, 0, 0],
					loadOp: 'clear',
					storeOp: 'store',
				}],
			},
		});
	}
	resources.textures.set(texture, levels);
	return levels;
}

/**
 * mip 0から残りのmip levelを生成するpassを、既存のcommand encoderへ記録する。
 * textureごとのviewとbind groupはWeakMapに保持し、内容の更新時には再利用する。
 */
export function generateMipmaps(
	device: GPUDevice,
	commandEncoder: GPUCommandEncoder,
	texture: GPUTexture,
	beginRenderPass: BeginRenderPass = (encoder, descriptor) => encoder.beginRenderPass(descriptor),
): void {
	if (texture.mipLevelCount <= 1) return;
	if (texture.dimension !== '2d' || texture.depthOrArrayLayers !== 1) {
		throw new Error('generateMipmaps supports only two-dimensional, single-layer textures');
	}

	const resources = getDeviceResources(device);
	const pipeline = getPipeline(device, resources, texture.format);
	for (const { bindGroup, passDescriptor } of getTextureResources(device, resources, texture)) {
		const pass = beginRenderPass(commandEncoder, passDescriptor);
		pass.setPipeline(pipeline);
		pass.setBindGroup(0, bindGroup);
		pass.draw(3);
		pass.end();
	}
}
