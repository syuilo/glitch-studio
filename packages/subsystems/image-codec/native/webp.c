#include <emscripten.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "src/webp/encode.h"

#define WEBP_INPUT_BLOCK_BYTES (1024 * 1024)
#define WEBP_OUTPUT_CHUNK_BYTES (1024 * 1024)

typedef struct {
	WebPPicture picture;
	WebPConfig config;
	uint32_t* pixels;
	uint8_t* block;
	int rows_per_block;
	int completed_rows;
	int encoded;
	size_t written_bytes;
	size_t output_bytes;
} WebpEncoder;

// 保存先はJS側が所有する。Promiseが解決するまでCのwriterを中断し、
// ディスクやWorker通信が遅くても圧縮結果のコピーを積み上げない。
// JSPIはWASM32のアドレス幅を変えず、4GiBの上限内で非同期I/Oを可能にする。
EM_ASYNC_JS(int, webp_write_chunk, (const uint8_t* data, size_t size, size_t completed, size_t total), {
	data >>>= 0; size >>>= 0; completed >>>= 0; total >>>= 0;
	return await Module['writeChunk'](HEAPU8.subarray(data, data + size), completed, total);
});

static int write_output(const uint8_t* data, size_t size, const WebPPicture* picture) {
	WebpEncoder* encoder = (WebpEncoder*)picture->custom_ptr;
	if (encoder->written_bytes == 0) {
		if (size < 12 || memcmp(data, "RIFF", 4) != 0) return 0;
		encoder->output_bytes = (size_t)data[4] | ((size_t)data[5] << 8) |
			((size_t)data[6] << 16) | ((size_t)data[7] << 24);
		encoder->output_bytes += 8;
	}
	while (size > 0) {
		const size_t count = size < WEBP_OUTPUT_CHUNK_BYTES ? size : WEBP_OUTPUT_CHUNK_BYTES;
		if (!webp_write_chunk(data, count, encoder->written_bytes + count, encoder->output_bytes)) return 0;
		encoder->written_bytes += count;
		data += count;
		size -= count;
	}
	return 1;
}

void webp_encoder_destroy(WebpEncoder* encoder) {
	if (encoder == NULL) return;
	WebPPictureFree(&encoder->picture);
	free(encoder->pixels);
	free(encoder->block);
	free(encoder);
}

WebpEncoder* webp_encoder_create(int width, int height, int lossless, float quality) {
	if (width < 1 || height < 1 || width > WEBP_MAX_DIMENSION || height > WEBP_MAX_DIMENSION) return NULL;
	WebpEncoder* encoder = (WebpEncoder*)calloc(1, sizeof(*encoder));
	if (encoder == NULL) return NULL;
	if (!WebPPictureInit(&encoder->picture) || !WebPConfigInit(&encoder->config)) goto Error;
	encoder->config.lossless = lossless;
	encoder->config.quality = quality;
	encoder->config.exact = 1;
	if (!WebPValidateConfig(&encoder->config)) goto Error;
	encoder->rows_per_block = WEBP_INPUT_BLOCK_BYTES / (width * 4);
	if (encoder->rows_per_block > 256) encoder->rows_per_block = 256;
	if (encoder->rows_per_block > height) encoder->rows_per_block = height;
	encoder->pixels = (uint32_t*)malloc((size_t)width * height * sizeof(uint32_t));
	encoder->block = (uint8_t*)malloc((size_t)width * encoder->rows_per_block * 4);
	if (encoder->pixels == NULL || encoder->block == NULL) goto Error;
	// WebPPictureは外部所有のARGBを借用できる。画像全体のRGBA入力やstd::stringを
	// 別途確保せず、ブロックの色順変換だけでこの一枚へ格納する。
	encoder->picture.width = width;
	encoder->picture.height = height;
	encoder->picture.use_argb = 1;
	encoder->picture.argb = encoder->pixels;
	encoder->picture.argb_stride = width;
	encoder->picture.writer = write_output;
	encoder->picture.custom_ptr = encoder;
	return encoder;
Error:
	webp_encoder_destroy(encoder);
	return NULL;
}

int webp_encoder_rows_per_block(const WebpEncoder* encoder) { return encoder->rows_per_block; }
uint8_t* webp_encoder_block(const WebpEncoder* encoder) { return encoder->block; }

int webp_encoder_write(WebpEncoder* encoder, int rows) {
	if (encoder->encoded || rows < 1 || rows > encoder->rows_per_block || encoder->completed_rows + rows > encoder->picture.height) return 0;
	const size_t count = (size_t)encoder->picture.width * rows;
	uint32_t* output = encoder->pixels + (size_t)encoder->completed_rows * encoder->picture.width;
	for (size_t index = 0; index < count; index++) {
		const uint8_t* pixel = encoder->block + index * 4;
		output[index] = ((uint32_t)pixel[3] << 24) | ((uint32_t)pixel[0] << 16) |
			((uint32_t)pixel[1] << 8) | pixel[2];
	}
	encoder->completed_rows += rows;
	return 1;
}

int webp_encoder_encode(WebpEncoder* encoder) {
	if (encoder->encoded || encoder->completed_rows != encoder->picture.height) return VP8_ENC_ERROR_INVALID_CONFIGURATION;
	encoder->encoded = 1;
	free(encoder->block);
	encoder->block = NULL;
	if (!encoder->config.lossless) {
		// 非可逆の符号化はYUVを使う。変換後のARGBを残すと、入力形式の変更で
		// 非可逆書き出しだけメモリが増えるため、借用画像の所有側で先に解放する。
		if (!WebPPictureARGBToYUVA(&encoder->picture, WEBP_YUV420)) return encoder->picture.error_code;
		free(encoder->pixels);
		encoder->pixels = NULL;
		encoder->picture.argb = NULL;
		encoder->picture.use_argb = 0;
	}
	const int ok = WebPEncode(&encoder->config, &encoder->picture);
	return ok ? VP8_ENC_OK : encoder->picture.error_code;
}
