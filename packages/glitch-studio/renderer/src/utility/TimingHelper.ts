// https://webgpufundamentals.org/webgpu/lessons/webgpu-timing.html

function assert(cond: unknown, msg = ''): asserts cond {
	if (!cond) {
		throw new Error(msg);
	}
}

// We track command buffers so we can generate an error if
// we try to read the result before the command buffer has been executed.
const s_unsubmittedCommandBuffer = new Set<GPUCommandBuffer>();

const PASSES_PER_QUERY_SET = 16;

/* global GPUQueue */
GPUQueue.prototype.submit = (function(origFn) {
	return function(this: GPUQueue, commandBuffers: Iterable<GPUCommandBuffer>) {
		// Snapshot single-use iterables before submit consumes them.
		const buffers = Array.from(commandBuffers);
		origFn.call(this, buffers);
		buffers.forEach(cb => s_unsubmittedCommandBuffer.delete(cb));
	};
})(GPUQueue.prototype.submit);

// See https://webgpufundamentals.org/webgpu/lessons/webgpu-timing.html
export default class TimingHelper {
	#canTimestamp;
	#device;
	#queryBatches: { querySet: GPUQuerySet; resolveBuffer: GPUBuffer; }[] = [];
	#resultBuffer: GPUBuffer | undefined;
	#commandBuffer: GPUCommandBuffer | undefined;
	#commandEncoder: GPUCommandEncoder | undefined;
	#passCount = 0;
	#resultBuffers: GPUBuffer[] = [];
	#state: 'free' | 'recording' | 'need finish' | 'wait for result' = 'free';

	constructor(device: GPUDevice) {
		this.#device = device;
		this.#canTimestamp = device.features.has('timestamp-query');
	}

	#withTimestampWrites<T extends GPURenderPassDescriptor | GPUComputePassDescriptor>(encoder: GPUCommandEncoder, descriptor: T): T {
		if (this.#canTimestamp) {
			if (this.#state === 'free') {
				this.#state = 'recording';
				this.#commandEncoder = encoder;

				const resolve = () => this.#resolveTiming(encoder);
				const trackCommandBuffer = (cb: GPUCommandBuffer) => this.#trackCommandBuffer(cb);
				encoder.finish = (function(origFn) {
					return function(this: GPUCommandEncoder, descriptor?: GPUCommandBufferDescriptor) {
						resolve();
						const cb = origFn.call(this, descriptor);
						trackCommandBuffer(cb);
						return cb;
					};
				})(encoder.finish);
			} else {
				assert(this.#state === 'recording', 'state not recording');
				assert(this.#commandEncoder === encoder, 'all measured passes must use the same command encoder');
			}

			const batchIndex = Math.floor(this.#passCount / PASSES_PER_QUERY_SET);
			if (!this.#queryBatches[batchIndex]) {
				const querySet = this.#device.createQuerySet({ type: 'timestamp', count: PASSES_PER_QUERY_SET * 2 });
				const resolveBuffer = this.#device.createBuffer({
					size: PASSES_PER_QUERY_SET * 2 * 8,
					usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
				});
				this.#queryBatches.push({ querySet, resolveBuffer });
			}
			const beginningOfPassWriteIndex = (this.#passCount % PASSES_PER_QUERY_SET) * 2;
			this.#passCount++;

			return {
				...descriptor,
				timestampWrites: {
					querySet: this.#queryBatches[batchIndex].querySet,
					beginningOfPassWriteIndex,
					endOfPassWriteIndex: beginningOfPassWriteIndex + 1,
				},
			};
		} else {
			return descriptor;
		}
	}

	beginRenderPass(encoder: GPUCommandEncoder, descriptor: GPURenderPassDescriptor): GPURenderPassEncoder {
		return encoder.beginRenderPass(this.#withTimestampWrites(encoder, descriptor));
	}

	beginComputePass(encoder: GPUCommandEncoder, descriptor: GPUComputePassDescriptor = {}): GPUComputePassEncoder {
		return encoder.beginComputePass(this.#withTimestampWrites(encoder, descriptor));
	}

	#trackCommandBuffer(cb: GPUCommandBuffer) {
		if (!this.#canTimestamp) {
			return;
		}
		assert(this.#state === 'need finish', 'you must call encoder.finish');
		this.#commandBuffer = cb;
		s_unsubmittedCommandBuffer.add(cb);
		this.#state = 'wait for result';
	}

	#resolveTiming(encoder: GPUCommandEncoder) {
		if (!this.#canTimestamp) {
			return;
		}
		assert(
			this.#state === 'recording',
			'you must use timerHelper.beginComputePass or timerHelper.beginRenderPass',
		);
		assert(this.#commandEncoder === encoder, 'all measured passes must use the same command encoder');
		this.#state = 'need finish';

		const batchCount = Math.ceil(this.#passCount / PASSES_PER_QUERY_SET);
		const resultSize = batchCount * PASSES_PER_QUERY_SET * 2 * 8;
		const bufferIndex = this.#resultBuffers.findIndex(buffer => buffer.size >= resultSize);
		this.#resultBuffer = bufferIndex >= 0 ? this.#resultBuffers.splice(bufferIndex, 1)[0] : this.#device.createBuffer({
			size: resultSize,
			usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
		});

		// Each resolve starts at offset zero (WebGPU requires 256-byte alignment).
		// Collect every batch into one readback buffer, including a partial final batch.
		for (let i = 0; i < batchCount; i++) {
			const { querySet, resolveBuffer } = this.#queryBatches[i];
			const queryCount = Math.min(PASSES_PER_QUERY_SET, this.#passCount - i * PASSES_PER_QUERY_SET) * 2;
			encoder.resolveQuerySet(querySet, 0, queryCount, resolveBuffer, 0);
			encoder.copyBufferToBuffer(resolveBuffer, 0, this.#resultBuffer, i * PASSES_PER_QUERY_SET * 2 * 8, queryCount * 8);
		}
	}

	async getResult() {
		// Cached frames may not record any measured passes.
		if (!this.#canTimestamp || this.#state === 'free') {
			return 0;
		}
		assert(
			this.#state === 'wait for result',
			'you must call encoder.finish and submit the command buffer before you can read the result',
		);
		assert(!!this.#commandBuffer); // internal check
		assert(
			!s_unsubmittedCommandBuffer.has(this.#commandBuffer),
			'you must submit the command buffer before you can read the result',
		);
		const queryCount = this.#passCount * 2;
		this.#commandBuffer = undefined;
		this.#commandEncoder = undefined;
		this.#passCount = 0;
		this.#state = 'free';

		const resultBuffer = this.#resultBuffer;
		assert(resultBuffer); // internal check
		await resultBuffer.mapAsync(GPUMapMode.READ);
		const times = new BigUint64Array(resultBuffer.getMappedRange());
		let duration = 0n;
		for (let i = 0; i < queryCount; i += 2) {
			const passDuration = times[i + 1] - times[i];
			if (passDuration < 0n) {
				duration = passDuration;
				break;
			}
			duration += passDuration;
		}
		resultBuffer.unmap();
		this.#resultBuffers.push(resultBuffer);
		return Number(duration);
	}
}
