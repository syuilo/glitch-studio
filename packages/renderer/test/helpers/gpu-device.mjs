globalThis.GPUQueue = class { submit() {} writeBuffer() {} writeTexture() {} };
globalThis.GPUBufferUsage = { QUERY_RESOLVE: 1, COPY_SRC: 2, COPY_DST: 4, MAP_READ: 8, UNIFORM: 16, STORAGE: 32 };
globalThis.GPUTextureUsage = { TEXTURE_BINDING: 1, RENDER_ATTACHMENT: 2, STORAGE_BINDING: 4, COPY_SRC: 8, COPY_DST: 16 };
globalThis.GPUShaderStage = { COMPUTE: 1, VERTEX: 2, FRAGMENT: 4 };
globalThis.GPUMapMode = { READ: 1 };

// Model GPU timestamps at the API boundary: a dispatch costs 1 us, a draw 0.1 us.
// Only passes with timestampWrites contribute to the real renderer's statistics.
export function createDevice(canTimestamp) {
	const beginPass = ({ timestampWrites } = {}) => {
		let duration = 0n;
		return {
			setPipeline() {}, setBindGroup() {}, setScissorRect() {}, setBlendConstant() {},
			dispatchWorkgroups() { duration += 1000n; },
			draw() { duration += 100n; },
			end() {
				if (!timestampWrites) return;
				const { querySet, beginningOfPassWriteIndex, endOfPassWriteIndex } = timestampWrites;
				querySet.times[beginningOfPassWriteIndex] = 10n;
				querySet.times[endOfPassWriteIndex] = 10n + duration;
			},
		};
	};
	return {
		lost: new Promise(() => {}),
		features: new Set(canTimestamp ? ['timestamp-query'] : []),
		limits: { minUniformBufferOffsetAlignment: 256, maxStorageBufferBindingSize: 128 * 1024 * 1024, maxBufferSize: 256 * 1024 * 1024, maxTextureDimension2D: 8192 },
		queue: new GPUQueue(),
		createQuerySet: ({ count }) => ({ count, times: new BigUint64Array(count) }),
		createBuffer: ({ size }) => ({
			size, data: new ArrayBuffer(size),
			async mapAsync() {}, getMappedRange() { return this.data; }, unmap() {}, destroy() {},
		}),
		createTexture: ({ size = [64, 64], format = 'bgra8unorm', dimension = '2d', mipLevelCount = 1, sampleCount = 1, usage = 0, label = '' } = {}) => {
			const [width, height = 1, depthOrArrayLayers = 1] = Array.isArray(size) ? size : [size.width, size.height, size.depthOrArrayLayers];
			return {
				width, height, depthOrArrayLayers, format, dimension, mipLevelCount, sampleCount, usage, label,
				createView(descriptor = {}) { return { descriptor, texture: this }; },
				destroy() {},
			};
		},
		createShaderModule() { return {}; },
		createComputePipeline() { return { getBindGroupLayout() { return {}; } }; },
		createRenderPipeline() { return { getBindGroupLayout() { return {}; } }; },
		createBindGroupLayout() { return {}; }, createPipelineLayout() { return {}; },
		createBindGroup() { return {}; }, createSampler() { return {}; }, destroy() {},
		createCommandEncoder: () => ({
			beginComputePass: beginPass, beginRenderPass: beginPass, clearBuffer() {},
			resolveQuerySet(querySet, first, count, destination, offset) {
				new BigUint64Array(destination.data, offset, count).set(querySet.times.subarray(first, first + count));
			},
			copyBufferToBuffer(source, sourceOffset, destination, destinationOffset, size) {
				new Uint8Array(destination.data, destinationOffset, size).set(new Uint8Array(source.data, sourceOffset, size));
			},
			finish() { return {}; },
		}),
	};
}
