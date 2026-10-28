/** 作品の描画はGPUのまま、完成画像をCanvasへ渡す経路だけを選ぶ。 */
export type PreviewDisplayMode = 'gpu' | 'cpu';
export type CpuPreviewCanvasTarget = 'canvas' | 'histogramCanvas' | 'waveformHorizontalCanvas' | 'waveformVerticalCanvas';
export type CpuPreviewPixels = { frameId: number; width: number; height: number; pixels: ArrayBuffer };
export type CpuPreviewFrame = CpuPreviewPixels & { target: CpuPreviewCanvasTarget };

/** GPUCanvasContextと、通常テクスチャへ描くCPU表示経路に必要な描画先の契約。 */
export type PreviewCanvasContext = Pick<GPUCanvasContext, 'canvas' | 'configure' | 'getCurrentTexture' | 'unconfigure'>;

type ReadbackBuffer = { buffer: GPUBuffer; size: number };

/**
 * GPUのコピー先は256byte境界の行幅、ImageDataは隙間のない未乗算RGBAを要求する。
 * Canvasへそのまま渡すとBGRAの赤青が逆転し、乗算済み色は二重に暗くなるため両方を変換する。
 */
export function copyPreviewPixels(source: Uint8Array, destination: Uint8ClampedArray, width: number, height: number, bytesPerRow: number, blueFirst: boolean) {
	for (let row = 0; row < height; row++) {
		for (let column = 0; column < width; column++) {
			const sourceIndex = row * bytesPerRow + column * 4;
			const destinationIndex = (row * width + column) * 4;
			const alpha = source[sourceIndex + 3];
			const factor = alpha === 0 ? 0 : 255 / alpha;
			destination[destinationIndex] = source[sourceIndex + (blueFirst ? 2 : 0)] * factor;
			destination[destinationIndex + 1] = source[sourceIndex + 1] * factor;
			destination[destinationIndex + 2] = source[sourceIndex + (blueFirst ? 0 : 2)] * factor;
			destination[destinationIndex + 3] = alpha;
		}
	}
}

/** UIと共有しないGPUTextureを読み戻し、未乗算RGBAの完成画像を表示側へ渡す。 */
export class CpuPreviewCanvasContext implements PreviewCanvasContext {
	private configuration: GPUCanvasConfiguration | null = null;
	private texture: GPUTexture | null = null;
	private availablePixelBuffers: ArrayBuffer[] = [];
	private readonly buffers = new Set<ReadbackBuffer>();
	private availableBuffers: ReadbackBuffer[] = [];
	private generation = 0;
	private nextSequence = 0;
	private presentedSequence = -1;
	private readonly pendingFrames = new Set<number>();
	private readonly capacityWaiters = new Set<() => void>();

	constructor(public readonly canvas: OffscreenCanvas, private readonly presentPixels: (frame: CpuPreviewPixels) => void) {}

	public recyclePixels(frameId: number, pixels: ArrayBuffer) {
		if (!this.releasePendingFrame(frameId)) return;
		// 表示側から所有権が戻ったものだけを再利用する。サイズ変更前の返却分は保持しない。
		if (this.configuration != null && pixels.byteLength === this.canvas.width * this.canvas.height * 4 && this.availablePixelBuffers.length < 4) this.availablePixelBuffers.push(pixels);
	}

	public waitForReadbackCapacity(): Promise<void> {
		if (this.pendingFrames.size < 2) return Promise.resolve();
		return new Promise(resolve => this.capacityWaiters.add(resolve));
	}

	private releasePendingFrame(frameId: number): boolean {
		const released = this.pendingFrames.delete(frameId);
		this.notifyAvailableCapacity();
		return released;
	}

	private notifyAvailableCapacity() {
		if (this.pendingFrames.size >= 2) return;
		for (const resolve of this.capacityWaiters) resolve();
		this.capacityWaiters.clear();
	}

	public configure(configuration: GPUCanvasConfiguration) {
		this.unconfigure();
		if (configuration.format !== 'rgba8unorm' && configuration.format !== 'bgra8unorm') throw new Error('CPU preview requires an 8-bit RGBA or BGRA output');
		this.configuration = configuration;
	}

	public getCurrentTexture(): GPUTexture {
		const configuration = this.configuration;
		if (configuration == null) throw new Error('CPU preview canvas is not configured');
		if (this.texture == null || this.texture.width !== this.canvas.width || this.texture.height !== this.canvas.height) {
			this.invalidatePendingFrames();
			this.texture?.destroy();
			this.texture = configuration.device.createTexture({
				label: 'CPU preview output',
				size: [Math.max(1, this.canvas.width), Math.max(1, this.canvas.height)],
				format: configuration.format,
				usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
			});
		}
		return this.texture;
	}

	/** コピーは描画と同じqueueへ先に送信し、次のフレームが出力Textureを上書きしても混ざらないようにする。 */
	public prepareReadback(encoder: GPUCommandEncoder): (() => Promise<void>) | null {
		const configuration = this.configuration;
		const texture = this.texture;
		// UIでの表示・返却まで最大2枚。GPU読み戻しが速くても、UIに画像を積み上げない。
		if (configuration == null || texture == null || this.pendingFrames.size >= 2) return null;
		const width = texture.width;
		const height = texture.height;
		const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
		const size = bytesPerRow * height;
		let readback = this.availableBuffers.pop() ?? null;
		if (readback != null && readback.size !== size) {
			readback.buffer.destroy();
			this.buffers.delete(readback);
			readback = null;
		}
		readback ??= { buffer: configuration.device.createBuffer({ label: 'CPU preview readback', size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }), size };
		this.buffers.add(readback);
		const reservedReadback = readback;
		const { buffer } = readback;
		const generation = this.generation;
		const sequence = this.nextSequence++;
		this.pendingFrames.add(sequence);
		encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [width, height]);
		return async () => {
			let published = false;
			try {
				await buffer.mapAsync(GPUMapMode.READ);
				// 編集・サイズ変更・破棄後の画像と、先に表示済みの新しい画像を巻き戻す完了通知を捨てる。
				if (generation !== this.generation || sequence < this.presentedSequence || width !== this.canvas.width || height !== this.canvas.height) return;
				const pixels = this.availablePixelBuffers.pop() ?? new ArrayBuffer(width * height * 4);
				copyPreviewPixels(new Uint8Array(buffer.getMappedRange()), new Uint8ClampedArray(pixels), width, height, bytesPerRow, configuration.format === 'bgra8unorm');
				this.presentPixels({ frameId: sequence, width, height, pixels });
				published = true;
				this.presentedSequence = sequence;
			} catch (error) {
				// 意図した破棄ではmapAsyncも中断される。旧Workerの後始末を新しい描画の失敗にしない。
				if (generation === this.generation) throw error;
			} finally {
				if (!published) this.releasePendingFrame(sequence);
				if (buffer.mapState === 'mapped') buffer.unmap();
				if (generation === this.generation && this.configuration != null) this.availableBuffers.push(reservedReadback);
				else { buffer.destroy(); this.buffers.delete(reservedReadback); }
			}
		};
	}

	public invalidatePendingFrames() {
		this.generation++;
		this.availablePixelBuffers = [];
		this.pendingFrames.clear();
		this.notifyAvailableCapacity();
		for (const readback of this.availableBuffers) { readback.buffer.destroy(); this.buffers.delete(readback); }
		this.availableBuffers = [];
	}

	public unconfigure() {
		this.invalidatePendingFrames();
		this.configuration = null;
		this.texture?.destroy();
		this.texture = null;
		for (const readback of this.buffers) readback.buffer.destroy();
		this.buffers.clear();
	}
}

export function createPreviewCanvasContext(canvas: OffscreenCanvas, mode: PreviewDisplayMode, presentPixels: (frame: CpuPreviewPixels) => void): PreviewCanvasContext {
	if (mode === 'cpu') return new CpuPreviewCanvasContext(canvas, presentPixels);
	const context = canvas.getContext('webgpu');
	if (!(context instanceof GPUCanvasContext)) throw new Error('cannot get webgpu context');
	return context;
}
