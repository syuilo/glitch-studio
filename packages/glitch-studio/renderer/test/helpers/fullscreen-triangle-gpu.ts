import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';

// 移行前の2枚の三角形を独立した比較対象として残す。
const referenceVertexCode = `
struct VertexOut { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) index: u32) -> VertexOut {
	let positions = array(vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1));
	return VertexOut(vec4f(positions[index], 0, 1), positions[index]);
}`;

const fragmentCode = `
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@fragment fn coordinates(@location(0) position: vec2f) -> @location(0) vec4f {
	let uv = position * 0.5 + 0.5;
	let alpha = 0.25 + uv.x * 0.5;
	return vec4f(vec3f(uv, 0.25) * alpha, alpha);
}
@fragment fn sampled(@location(0) position: vec2f) -> @location(0) vec4f {
	return textureSample(source, sourceSampler, position * vec2f(0.75, 0.5) + 0.5);
}
@fragment fn derivatives(@location(0) position: vec2f) -> @location(0) vec4f {
	return vec4f(fwidth(position), dpdx(position.x), dpdy(position.y));
}
@fragment fn coverage() -> @location(0) vec4f {
	return vec4f(0.125, 0.25, 0.375, 0.5);
}`;

export async function run() {
	const adapter = await navigator.gpu.requestAdapter();
	if (adapter == null) throw new Error('WebGPU adapter unavailable');
	const device = await adapter.requestDevice();
	device.pushErrorScope('validation');
	const vertices = [referenceVertexCode, vertexCode].map(code => device.createShaderModule({ code }));
	const fragment = device.createShaderModule({ code: fragmentCode });
	const resources: { destroy(): void }[] = [];
	const checks: string[] = [];
	const near = (actual: number, expected: number, label: string, tolerance = 0.000002) => {
		if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) throw new Error(`${label}: ${actual} != ${expected}`);
	};
	try {
		const source = device.createTexture({ size: [4, 4], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
		resources.push(source);
		const pixels = Uint8Array.from(Array.from({ length: 16 }, (_, index) => {
			const alpha = (index % 4) * 85;
			return [alpha * Math.floor(index / 4) / 3, alpha / 2, 0, alpha];
		}).flat());
		device.queue.writeTexture({ texture: source }, pixels, { bytesPerRow: 16 }, [4, 4]);
		const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'mirror-repeat', addressModeV: 'repeat' });
		// 【座標・微分・透明画像の補間・被覆率を移行前と全画素比較する】
		// 奇数寸法と1画素幅も含め、画面端や対角線の欠落、上下反転、頂点での誤ったclampを検出する。
		for (const entryPoint of ['coordinates', 'sampled', 'derivatives', 'coverage']) {
			const blended = entryPoint === 'coverage';
			const pipelines = vertices.map(vertex => device.createRenderPipeline({
				layout: 'auto', vertex: { module: vertex },
				fragment: { module: fragment, entryPoint, targets: [{
					format: blended ? 'rgba8unorm' : 'rgba32float',
					// 加算合成なら対角線が重複して描かれた場合も検出できる。
					...(blended ? { blend: { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } } } : {}),
				}] },
				primitive: { topology: 'triangle-list', cullMode: 'back' },
			}));
			const groups = pipelines.map(pipeline => entryPoint === 'sampled' ? device.createBindGroup({
				layout: pipeline.getBindGroupLayout(0),
				entries: [{ binding: 0, resource: source.createView() }, { binding: 1, resource: sampler }],
			}) : null);
			for (const [width, height] of [[1, 1], [1, 7], [9, 1], [16, 16], [65, 33], [33, 65], [127, 72]]) {
				const bytesPerPixel = blended ? 4 : 16;
				const bytesPerRow = Math.ceil(width * bytesPerPixel / 256) * 256;
				const encoder = device.createCommandEncoder();
				const buffers = pipelines.map((pipeline, index) => {
					const target = device.createTexture({ size: [width, height], format: blended ? 'rgba8unorm' : 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
					const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
					resources.push(target, buffer);
					const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store' }] });
					pass.setPipeline(pipeline);
					const group = groups[index];
					if (group != null) pass.setBindGroup(0, group);
					pass.draw(index === 0 ? 6 : 3);
					pass.end();
					encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow }, [width, height]);
					return buffer;
				});
				device.queue.submit([encoder.finish()]);
				await Promise.all(buffers.map(buffer => buffer.mapAsync(GPUMapMode.READ)));
				const outputs = buffers.map(buffer => blended ? new Uint8Array(buffer.getMappedRange()) : new Float32Array(buffer.getMappedRange()));
				for (let y = 0; y < height; y++) {
					for (let x = 0; x < width; x++) {
						const offset = y * bytesPerRow / (blended ? 1 : 4) + x * 4;
						const uvX = (x + 0.5) / width;
						const uvY = 1 - (y + 0.5) / height;
						const alpha = 0.25 + uvX * 0.5;
						const expected = entryPoint === 'coordinates' ? [uvX * alpha, uvY * alpha, 0.25 * alpha, alpha]
							: entryPoint === 'derivatives' ? [2 / width, 2 / height, 2 / width, -2 / height]
								: blended ? [32, 64, 96, 128] : null;
						for (let channel = 0; channel < 4; channel++) {
							const label = `${entryPoint} ${width}x${height} (${x},${y}) channel ${channel}`;
							near(outputs[1][offset + channel], outputs[0][offset + channel], label);
							if (expected != null) near(outputs[1][offset + channel], expected[channel], label, blended ? 1 : 0.000002);
						}
					}
				}
				for (const buffer of buffers) buffer.unmap();
				checks.push(`${entryPoint} ${width}x${height}`);
			}
		}
		const error = await device.popErrorScope();
		if (error != null) throw new Error(error.message);
		return checks;
	} finally {
		for (const resource of resources) resource.destroy();
		device.destroy();
	}
}
