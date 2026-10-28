/** 作品の描画はGPUのまま、完成画像をCanvasへ渡す経路だけを選ぶ。 */
export type PreviewDisplayMode = 'gpu' | 'cpu';
export type CpuPreviewCanvasTarget = 'canvas' | 'histogramCanvas' | 'waveformHorizontalCanvas' | 'waveformVerticalCanvas';
export type CpuPreviewPixels = { frameId: number; width: number; height: number; pixels: ArrayBuffer };
export type CpuPreviewFrame = CpuPreviewPixels & { target: CpuPreviewCanvasTarget };

/** GPUCanvasContextと、通常テクスチャへ描くCPU表示経路に必要な描画先の契約。 */
export type PreviewCanvasContext = Pick<GPUCanvasContext, 'canvas' | 'configure' | 'getCurrentTexture' | 'unconfigure'>;

type ReadbackBuffer = { buffer: GPUBuffer; size: number };
export type CpuPreviewReadback = { complete(): Promise<void>; cancel(): void };

const isLittleEndian = new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] === 0x04;

/**
 * GPUのコピー先は256byte境界の行幅、ImageDataは隙間のない未乗算RGBAを要求する。
 * Canvasへそのまま渡すとBGRAの赤青が逆転し、乗算済み色は二重に暗くなるため両方を変換する。
 */
export function copyPreviewPixels(source: Uint8Array, destination: Uint8ClampedArray, width: number, height: number, bytesPerRow: number, blueFirst: boolean) {
	// 32bitのRGBAを扱う条件を呼び出しごとに確認する。行paddingは飛ばし、subarrayの範囲も守る。
	// 下のビット演算はlittle endian用なので、それ以外や4byte境界でない配置は従来のbyte経路を使う。
	const canCopyPackedPixels = isLittleEndian && bytesPerRow % 4 === 0
		&& source.byteOffset % 4 === 0 && source.byteLength % 4 === 0
		&& destination.byteOffset % 4 === 0 && destination.byteLength % 4 === 0;
	const sourcePixels = canCopyPackedPixels ? new Uint32Array(source.buffer, source.byteOffset, source.byteLength / 4) : null;
	const destinationPixels = canCopyPackedPixels ? new Uint32Array(destination.buffer, destination.byteOffset, destination.byteLength / 4) : null;
	for (let row = 0; row < height; row++) {
		for (let column = 0; column < width; column++) {
			const sourceIndex = row * bytesPerRow + column * 4;
			const destinationIndex = (row * width + column) * 4;
			// alphaを先に判定し、半透明画素には32bit viewの参照や追加の画素読み出しを増やさない。
			const alpha = source[sourceIndex + 3];
			if (alpha === 255 && sourcePixels != null && destinationPixels != null) {
				const pixel = sourcePixels[sourceIndex / 4];
				// 不透明画素のalpha補正は恒等変換。RGBAをまとめてコピーし、BGRAなら赤青だけ交換する。
				// 0xff00ff00でalphaと緑を残し、下位byteと16〜23bitのbyteを入れ替える。
				destinationPixels[destinationIndex / 4] = blueFirst
					? (pixel & 0xff00ff00) | ((pixel >>> 16) & 0xff) | ((pixel & 0xff) << 16) : pixel;
				continue;
			}
			// 半透明画素は従来と同じ丸め・clampで未乗算RGBへ戻す。完全透明の残色も消す。
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
	// 上限と描画前の予約はCpuPreviewFrameQueueが所有する。ここでは返却IDと解放通知だけを保持する。
	private readonly pendingFrames = new Map<number, () => void>();

	constructor(public readonly canvas: OffscreenCanvas, private readonly presentPixels: (frame: CpuPreviewPixels) => void) {}

	public recyclePixels(frameId: number, pixels: ArrayBuffer) {
		if (!this.releasePendingFrame(frameId)) return;
		// 表示側から所有権が戻ったものだけを再利用する。サイズ変更前の返却分は保持しない。
		if (this.configuration != null && pixels.byteLength === this.canvas.width * this.canvas.height * 4 && this.availablePixelBuffers.length < 4) this.availablePixelBuffers.push(pixels);
	}

	private releasePendingFrame(frameId: number): boolean {
		const release = this.pendingFrames.get(frameId);
		if (release == null) return false;
		this.pendingFrames.delete(frameId);
		release();
		return true;
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

	/** 予約済みフレームのコピーを最終描画と同じencoderへ記録する。completeはsubmit後に呼ぶ。 */
	public prepareReadback(encoder: GPUCommandEncoder, onReleased: () => void): CpuPreviewReadback | null {
		const configuration = this.configuration;
		const texture = this.texture;
		if (configuration == null || texture == null) return null;
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
		this.pendingFrames.set(sequence, onReleased);
		let cancelled = false;
		let holdsReadback = true;
		const cancel = () => {
			cancelled = true;
			this.releasePendingFrame(sequence);
			// 未送信のencoderやmapAsync待機中だけを破棄する。プールへ戻ったbufferは別フレームの所有物。
			if (holdsReadback) { holdsReadback = false; buffer.destroy(); this.buffers.delete(reservedReadback); }
		};
		try { encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [width, height]); } catch (error) { cancel(); throw error; }
		const read = async () => {
			if (cancelled) return;
			let published = false;
			try {
				await buffer.mapAsync(GPUMapMode.READ);
				// 編集・サイズ変更・破棄後の画像と、先に表示済みの新しい画像を巻き戻す完了通知を捨てる。
				if (cancelled || generation !== this.generation || sequence < this.presentedSequence || width !== this.canvas.width || height !== this.canvas.height) return;
				const pixels = this.availablePixelBuffers.pop() ?? new ArrayBuffer(width * height * 4);
				copyPreviewPixels(new Uint8Array(buffer.getMappedRange()), new Uint8ClampedArray(pixels), width, height, bytesPerRow, configuration.format === 'bgra8unorm');
				this.presentPixels({ frameId: sequence, width, height, pixels });
				published = true;
				this.presentedSequence = sequence;
			} catch (error) {
				// 意図した破棄ではmapAsyncも中断される。旧Workerの後始末を新しい描画の失敗にしない。
				if (!cancelled && generation === this.generation) throw error;
			} finally {
				if (!published) this.releasePendingFrame(sequence);
				if (buffer.mapState === 'mapped') buffer.unmap();
				if (!cancelled && generation === this.generation && this.configuration != null) this.availableBuffers.push(reservedReadback);
				else { buffer.destroy(); this.buffers.delete(reservedReadback); }
				holdsReadback = false;
			}
		};
		let completion: Promise<void> | null = null;
		return { complete: () => completion ??= read(), cancel };
	}

	public invalidatePendingFrames() {
		this.generation++;
		this.availablePixelBuffers = [];
		for (const frameId of this.pendingFrames.keys()) this.releasePendingFrame(frameId);
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
