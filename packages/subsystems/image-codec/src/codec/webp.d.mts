export type WebpModule = {
	HEAPU8: Uint8Array;
	_webp_encoder_create(width: number, height: number, lossless: number, quality: number): number;
	_webp_encoder_rows_per_block(encoder: number): number;
	_webp_encoder_block(encoder: number): number;
	_webp_encoder_write(encoder: number, rows: number): number;
	_webp_encoder_encode(encoder: number): Promise<number>;
	_webp_encoder_destroy(encoder: number): void;
};
export default function createWebpModule(options: {
	wasmBinary?: ArrayBuffer;
	writeChunk(chunk: Uint8Array, completedBytes: number, totalBytes: number): Promise<boolean>;
}): Promise<WebpModule>;
