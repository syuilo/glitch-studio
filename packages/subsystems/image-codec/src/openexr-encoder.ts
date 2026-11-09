import createTinyExrModule from './codec/tinyexr.mjs';
import type { TinyExrModule } from './codec/tinyexr.mjs';

export type OpenExrCompression = 'none' | 'zip';

/** 上から順に並ぶ、乗算済みlinear sRGBのHALF RGBAを受け取る。 */
export class OpenExrEncoder {
	private encoder: number;
	private completedRows = 0;
	private readonly codec: TinyExrModule;
	public readonly width: number;
	public readonly height: number;
	public readonly rowsPerBlock: number;

	private constructor(codec: TinyExrModule, width: number, height: number, compression: OpenExrCompression) {
		this.codec = codec;
		this.width = width;
		this.height = height;
		this.rowsPerBlock = compression === 'zip' ? 16 : 1;
		this.encoder = codec._openexr_encoder_create(width, height, compression === 'zip' ? 3 : 0);
		if (this.encoder === 0) throw new Error('Could not initialize the OpenEXR encoder.');
	}

	public static async create(options: { width: number; height: number; compression: OpenExrCompression }, wasmBinary?: ArrayBuffer): Promise<OpenExrEncoder> {
		if (![options.width, options.height].every(value => Number.isInteger(value) && value >= 1 && value <= 8192)) throw new Error('Invalid OpenEXR dimensions.');
		if (options.compression !== 'none' && options.compression !== 'zip') throw new Error('Unsupported OpenEXR compression.');
		// ジョブごとにWASMメモリを所有し、Workerの終了とともに大きくなったheapも解放する。
		const codec = await createTinyExrModule(wasmBinary == null ? {} : { wasmBinary });
		return new OpenExrEncoder(codec, options.width, options.height, options.compression);
	}

	public writeBlock(pixels: Uint16Array): void {
		if (this.encoder === 0) throw new Error('OpenEXR encoder is closed.');
		const rows = Math.min(this.rowsPerBlock, this.height - this.completedRows);
		if (rows <= 0 || pixels.length !== this.width * rows * 4) throw new Error('Invalid OpenEXR pixel block.');
		// 前回の圧縮でWASMメモリが成長し得るため、heapのviewは毎回取得する。
		this.codec.HEAPU16.set(pixels, this.codec._openexr_encoder_pixels(this.encoder) / 2);
		this.check(this.codec._openexr_encoder_write(this.encoder));
		this.completedRows += rows;
	}

	public finish(): ArrayBuffer {
		if (this.encoder === 0) throw new Error('OpenEXR encoder is closed.');
		try {
			if (this.completedRows !== this.height) throw new Error('OpenEXR image is incomplete.');
			this.check(this.codec._openexr_encoder_finish(this.encoder));
			const pointer = this.codec._openexr_encoder_data(this.encoder);
			return this.codec.HEAPU8.slice(pointer, pointer + this.codec._openexr_encoder_size(this.encoder)).buffer;
		} finally { this.dispose(); }
	}

	public dispose(): void {
		if (this.encoder === 0) return;
		this.codec._openexr_encoder_destroy(this.encoder);
		this.encoder = 0;
	}

	private check(result: number): void {
		if (result < 0) throw new Error(`OpenEXR: ${this.codec.UTF8ToString(this.codec._exr_result_string(result))}`);
	}
}
