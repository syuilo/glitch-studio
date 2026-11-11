export type TinyExrModule = {
	HEAPU8: Uint8Array;
	HEAPU16: Uint16Array;
	UTF8ToString(pointer: number): string;
	_exr_result_string(result: number): number;
	_openexr_encoder_create(width: number, height: number, compression: number): number;
	_openexr_encoder_pixels(encoder: number): number;
	_openexr_encoder_write(encoder: number): number;
	_openexr_encoder_finish(encoder: number): number;
	_openexr_encoder_data(encoder: number, offset: number): number;
	_openexr_encoder_chunk_size(): number;
	_openexr_encoder_size(encoder: number): number;
	_openexr_encoder_destroy(encoder: number): void;
};
export default function createTinyExrModule(options?: { wasmBinary?: ArrayBuffer; locateFile?: (path: string) => string }): Promise<TinyExrModule>;
