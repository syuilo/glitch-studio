import createTinyExrModule from './codec/tinyexr.mjs';
import type { TinyExrModule } from './codec/tinyexr.mjs';

export type OpenExrCompression = 'none' | 'zip';
/** 借用viewはPromiseの完了まで有効。offset tableの後書きも同じ位置指定で受け取る。 */
export type OpenExrOutputWriter = (chunk: Uint8Array, position: number) => Promise<void>;

/** 乗算済みlinear sRGBのHALF RGBAを行順に受け取り、出力は保存完了を待ちながら渡す。 */
export class OpenExrEncoder {
	private completedRows = 0;
	private writing = false;
	private readonly codec: TinyExrModule;
	private encoder: number;
	private readonly outputFailure: { error: unknown };
	public readonly width: number;
	public readonly height: number;
	public readonly rowsPerBlock: number;

	private constructor(codec: TinyExrModule, encoder: number, width: number, height: number,
		compression: OpenExrCompression, outputFailure: { error: unknown }) {
		this.codec = codec;
		this.encoder = encoder;
		this.width = width;
		this.height = height;
		this.outputFailure = outputFailure;
		this.rowsPerBlock = compression === 'zip' ? 16 : 1;
	}

	public static async create(options: { width: number; height: number; compression: OpenExrCompression },
		writer: OpenExrOutputWriter, wasmBinary?: ArrayBuffer): Promise<OpenExrEncoder> {
		if (![options.width, options.height].every(value => Number.isInteger(value) && value >= 1 && value <= 0x7fffffff)) throw new Error('Invalid OpenEXR dimensions.');
		if (options.compression !== 'none' && options.compression !== 'zip') throw new Error('Unsupported OpenEXR compression.');
		const outputFailure: { error: unknown } = { error: null };
		// ヘッダーはcreate中にも出力される。保存先の例外をCのIO errorで置き換えず、
		// 呼び出し元へ元の原因を返す。保存中はWASMを再入・破棄しない。
		const codec = await createTinyExrModule({ ...(wasmBinary == null ? {} : { wasmBinary }),
			writeChunk: async (chunk, position) => {
				try { await writer(chunk, position); return true; } catch (error) { outputFailure.error = error; return false; }
			},
		});
		const encoder = await codec._openexr_encoder_create(options.width, options.height, options.compression === 'zip' ? 3 : 0) >>> 0;
		if (encoder === 0) {
			if (outputFailure.error != null) throw outputFailure.error;
			throw new Error('Could not initialize the OpenEXR encoder.');
		}
		return new OpenExrEncoder(codec, encoder, options.width, options.height, options.compression, outputFailure);
	}

	public async writeBlock(pixels: Uint16Array): Promise<void> {
		this.checkWritable();
		const rows = Math.min(this.rowsPerBlock, this.height - this.completedRows);
		if (rows <= 0 || pixels.length !== this.width * rows * 4) throw new Error('Invalid OpenEXR pixel block.');
		this.writing = true;
		try {
			const pointer = this.codec._openexr_encoder_pixels(this.encoder) >>> 0;
			this.codec.HEAPU16.set(pixels, pointer / 2);
			this.check(await this.codec._openexr_encoder_write(this.encoder));
			this.completedRows += rows;
		} finally { this.writing = false; }
	}

	public async finish(): Promise<number> {
		this.checkWritable();
		if (this.completedRows !== this.height) throw new Error('OpenEXR image is incomplete.');
		this.writing = true;
		try {
			this.check(await this.codec._openexr_encoder_finish(this.encoder));
			return this.codec._openexr_encoder_size(this.encoder);
		} finally {
			this.writing = false;
			this.dispose();
		}
	}

	public dispose(): void {
		if (this.writing) throw new Error('Cannot dispose OpenEXR resources while writing.');
		if (this.encoder === 0) return;
		this.codec._openexr_encoder_destroy(this.encoder);
		this.encoder = 0;
	}

	private checkWritable(): void {
		if (this.encoder === 0) throw new Error('OpenEXR encoder is closed.');
		if (this.writing) throw new Error('An OpenEXR write is already in progress.');
		if (this.outputFailure.error != null) throw this.outputFailure.error;
	}

	private check(result: number): void {
		if (this.outputFailure.error != null) throw this.outputFailure.error;
		if (result < 0) throw new Error('OpenEXR: ' + this.codec.UTF8ToString(this.codec._exr_result_string(result)));
	}
}
