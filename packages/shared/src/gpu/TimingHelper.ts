// https://webgpufundamentals.org/webgpu/lessons/webgpu-timing.html

function assert(cond: unknown, msg = ''): asserts cond {
	if (!cond) {
		throw new Error(msg);
	}
}

// We track command buffers so we can generate an error if
// we try to read the result before the command buffer has been executed.
const s_unsubmittedCommandBuffer = new Set<GPUCommandBuffer>();
const trackedQueues = new WeakSet<GPUQueue>();
const submittedReadbacks = new WeakMap<GPUCommandBuffer, () => void>();

type TimingResultObserver = (nanoseconds: number | null) => void;

const PASSES_PER_QUERY_SET = 16;

// See https://webgpufundamentals.org/webgpu/lessons/webgpu-timing.html
export default class TimingHelper {
	#canTimestamp;
	#device;
	#queryBatches: { querySet: GPUQuerySet; resolveBuffer: GPUBuffer; }[] = [];
	#resultBuffer: GPUBuffer | null = null;
	#commandBuffer: GPUCommandBuffer | null = null;
	#commandEncoder: GPUCommandEncoder | null = null;
	#passCount = 0;
	#resultBuffers: GPUBuffer[] = [];
	#pendingResultBuffers = new Set<GPUBuffer>();
	#passObservers: (TimingResultObserver | null)[] = [];
	#resultObservers: TimingResultObserver[] = [];
	#readAfterSubmission = false;
	#disposed = false;
	#state: 'free' | 'recording' | 'need finish' | 'wait for result' = 'free';

	constructor(device: GPUDevice) {
		this.#device = device;
		this.#canTimestamp = device.features.has('timestamp-query');
		// importだけで全GPUQueueを書き換えると、計測しない描画や書き出しにも
		// 配列化・追跡の負荷が残る。計測するデバイスのqueueだけを一度ラップする。
		const queue = device.queue;
		if (this.#canTimestamp && !trackedQueues.has(queue)) {
			trackedQueues.add(queue);
			const submit = queue.submit;
			queue.submit = function(commandBuffers) {
				const buffers = Array.from(commandBuffers);
				submit.call(this, buffers);
				for (const buffer of buffers) {
					s_unsubmittedCommandBuffer.delete(buffer);
					const read = submittedReadbacks.get(buffer);
					submittedReadbacks.delete(buffer);
					read?.();
				}
			};
		}
	}

	#withTimestampWrites<T extends GPURenderPassDescriptor | GPUComputePassDescriptor>(encoder: GPUCommandEncoder, descriptor: T, onResult: TimingResultObserver | null = null): T {
		assert(!this.#disposed, 'TimingHelper has been disposed');
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
			this.#passObservers.push(onResult);

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

	beginRenderPass(encoder: GPUCommandEncoder, descriptor: GPURenderPassDescriptor, onResult: TimingResultObserver | null = null): GPURenderPassEncoder {
		return encoder.beginRenderPass(this.#withTimestampWrites(encoder, descriptor, onResult));
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
		if (this.#readAfterSubmission) this.#scheduleReadback(cb);
	}

	/** 現在記録中のencoderの結果を購読する。統計と自動制御で同じQueryを共有できる。 */
	observeResult(observer: TimingResultObserver) {
		if (this.#disposed) observer(null);
		else if (!this.#canTimestamp || this.#state === 'free') observer(0);
		else this.#resultObservers.push(observer);
	}

	/**
	 * getResult()の呼び出しを所有しない計測専用の利用者向け。encoderのfinishと
	 * queue.submitは描画側が行い、その送信後にだけ非同期のreadbackを始める。
	 * 計測失敗はobserverへnullで返し、描画ループへ未処理のPromiseを残さない。
	 */
	readResultAfterSubmission() {
		if (this.#disposed || !this.#canTimestamp || this.#state === 'free') return;
		this.#readAfterSubmission = true;
		if (this.#commandBuffer != null) this.#scheduleReadback(this.#commandBuffer);
	}

	#scheduleReadback(commandBuffer: GPUCommandBuffer) {
		const read = () => { void this.getResult().catch(() => {}); };
		if (s_unsubmittedCommandBuffer.has(commandBuffer)) submittedReadbacks.set(commandBuffer, read);
		else read();
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
		const passObservers = this.#passObservers;
		const resultObservers = this.#resultObservers;
		this.#passObservers = [];
		this.#resultObservers = [];
		submittedReadbacks.delete(this.#commandBuffer);
		this.#readAfterSubmission = false;
		this.#commandBuffer = null;
		this.#commandEncoder = null;
		this.#passCount = 0;
		this.#state = 'free';

		const resultBuffer = this.#resultBuffer;
		assert(resultBuffer); // internal check
		this.#pendingResultBuffers.add(resultBuffer);
		let duration = 0n;
		const passDurations: number[] = [];
		try {
			await resultBuffer.mapAsync(GPUMapMode.READ);
			const times = new BigUint64Array(resultBuffer.getMappedRange());
			for (let i = 0; i < queryCount; i += 2) {
				const passDuration = times[i + 1] - times[i];
				if (passDuration < 0n) {
					duration = passDuration;
					break;
				}
				passDurations.push(Number(passDuration));
				duration += passDuration;
			}
			resultBuffer.unmap();
		} catch (error) {
			this.#pendingResultBuffers.delete(resultBuffer);
			resultBuffer.destroy();
			for (const observer of passObservers) observer?.(null);
			for (const observer of resultObservers) observer(null);
			throw error;
		}
		this.#pendingResultBuffers.delete(resultBuffer);
		if (this.#disposed) resultBuffer.destroy();
		else this.#resultBuffers.push(resultBuffer);
		const valid = !this.#disposed && duration >= 0n;
		for (const [index, observer] of passObservers.entries()) observer?.(valid ? passDurations[index] : null);
		for (const observer of resultObservers) observer(valid ? Number(duration) : null);
		return Number(duration);
	}
	/** 記録・readback中の破棄もnullで通知し、同時に滞留している全結果バッファを回収する。 */
	dispose() {
		if (this.#disposed) return;
		this.#disposed = true;
		const passObservers = this.#passObservers;
		const resultObservers = this.#resultObservers;
		this.#passObservers = [];
		this.#resultObservers = [];
		if (this.#commandBuffer != null) {
			s_unsubmittedCommandBuffer.delete(this.#commandBuffer);
			submittedReadbacks.delete(this.#commandBuffer);
		}
		this.#commandBuffer = null;
		this.#commandEncoder = null;
		this.#state = 'free';
		for (const batch of this.#queryBatches) {
			batch.querySet.destroy();
			batch.resolveBuffer.destroy();
		}
		for (const buffer of new Set([...this.#resultBuffers, ...this.#pendingResultBuffers, this.#resultBuffer])) buffer?.destroy();
		this.#queryBatches = [];
		this.#resultBuffers = [];
		this.#resultBuffer = null;
		this.#pendingResultBuffers.clear();
		for (const observer of passObservers) observer?.(null);
		for (const observer of resultObservers) observer(null);
	}
}
