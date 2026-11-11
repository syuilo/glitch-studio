import createWebpModule from './codec/webp.mjs';
import type { WebpModule } from './codec/webp.mjs';

export type WebpEncodingOptions = { lossless: boolean; quality: number };
export type WebpOutputWriter = (chunk: Uint8Array, completedBytes: number, totalBytes: number) => Promise<void>;

const encodingErrors = [
	'No error.', 'Not enough memory for WebP encoding (WASM32 limit: 4 GiB).',
	'Not enough memory for the WebP bitstream (WASM32 limit: 4 GiB).', 'Missing WebP image data.',
	'Invalid WebP encoding settings.', 'Invalid WebP image dimensions.', 'WebP header partition is too large.',
	'WebP partition is too large.', 'Could not write the WebP output.', 'WebP output exceeds the file size limit.',
	'WebP encoding was canceled.',
];

/** 未乗算の8bit sRGB RGBAを行順に受け取り、保存完了を待ちながら圧縮結果を渡す。 */
export class WebpEncoder {
	private encoder: number;
	private completedRows = 0;
	private encoding = false;
	private writeError: unknown = null;
	private writer: WebpOutputWriter | null = null;
	private readonly codec: WebpModule;
	public readonly width: number;
	public readonly height: number;
	public readonly rowsPerBlock: number;

	private constructor(codec: WebpModule, width: number, height: number, options: WebpEncodingOptions) {
		this.codec = codec;
		this.width = width;
		this.height = height;
		this.encoder = codec._webp_encoder_create(width, height, options.lossless ? 1 : 0, options.quality) >>> 0;
		if (this.encoder === 0) throw new Error(encodingErrors[1]);
		this.rowsPerBlock = codec._webp_encoder_rows_per_block(this.encoder);
	}

	public static async create(options: WebpEncodingOptions & { width: number; height: number }, wasmBinary?: ArrayBuffer): Promise<WebpEncoder> {
		if (![options.width, options.height].every(value => Number.isInteger(value) && value >= 1 && value <= 16383)) throw new Error('Invalid WebP image dimensions.');
		if (!Number.isFinite(options.quality) || options.quality < 0 || options.quality > 100) throw new Error('Invalid WebP quality.');
		let encoder: WebpEncoder | null = null;
		const codec = await createWebpModule({ ...(wasmBinary == null ? {} : { wasmBinary }),
			writeChunk: async (chunk, completedBytes, totalBytes) => {
				try {
					if (encoder?.writer == null) throw new Error('WebP output writer is closed.');
					// 借用viewはwriterのPromiseが完了するまで有効。保持・transferする側が
					// 必要な一チャンクだけコピーし、全画像・全ファイルの複製は作らない。
					await encoder.writer(chunk, completedBytes, totalBytes);
					return true;
				} catch (error) {
					if (encoder != null) encoder.writeError = error;
					return false;
				}
			},
		});
		encoder = new WebpEncoder(codec, options.width, options.height, options);
		return encoder;
	}

	public writeBlock(pixels: Uint8Array): void {
		if (this.encoder === 0 || this.encoding) throw new Error('WebP input is closed.');
		const rows = Math.min(this.rowsPerBlock, this.height - this.completedRows);
		if (rows <= 0 || pixels.byteLength !== this.width * rows * 4) throw new Error('Invalid WebP pixel block.');
		const pointer = this.codec._webp_encoder_block(this.encoder) >>> 0;
		this.codec.HEAPU8.set(pixels, pointer);
		if (this.codec._webp_encoder_write(this.encoder, rows) !== 1) throw new Error('Could not write the WebP pixel block.');
		this.completedRows += rows;
	}

	public async encode(writer: WebpOutputWriter): Promise<void> {
		if (this.encoder === 0 || this.encoding) throw new Error('WebP encoder is closed.');
		if (this.completedRows !== this.height) throw new Error('WebP image is incomplete.');
		this.encoding = true;
		this.writer = writer;
		try {
			const result = await this.codec._webp_encoder_encode(this.encoder);
			if (this.writeError != null) throw this.writeError;
			if (result !== 0) throw new Error(encodingErrors[result] ?? `WebP encoding failed (${result}).`);
		} finally {
			this.encoding = false;
			this.writer = null;
			this.dispose();
		}
	}

	public dispose(): void {
		if (this.encoding) throw new Error('Cannot dispose WebP resources while encoding.');
		if (this.encoder === 0) return;
		this.codec._webp_encoder_destroy(this.encoder);
		this.encoder = 0;
	}
}
