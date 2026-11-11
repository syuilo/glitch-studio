export type TinyExrModule = {
	HEAPU8: Uint8Array;
	HEAPU16: Uint16Array;
	UTF8ToString(pointer: number): string;
	_exr_result_string(result: number): number;
	_openexr_encoder_create(width: number, height: number, compression: number): Promise<number>;
	_openexr_encoder_pixels(encoder: number): number;
	_openexr_encoder_write(encoder: number): Promise<number>;
	_openexr_encoder_finish(encoder: number): Promise<number>;
	_openexr_encoder_size(encoder: number): number;
	_openexr_encoder_destroy(encoder: number): void;
};
export default function createTinyExrModule(options: {
	wasmBinary?: ArrayBuffer;
	locateFile?: (path: string) => string;
	writeChunk(chunk: Uint8Array, position: number): Promise<boolean>;
}): Promise<TinyExrModule>;
