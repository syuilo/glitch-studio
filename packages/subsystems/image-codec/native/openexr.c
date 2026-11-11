#include "exr.h"
#include "exr_internal.h"
#include <emscripten.h>
#include <stdlib.h>
#include <string.h>

#define OUTPUT_CHUNK_SIZE (1024u * 1024u)

/* 画像・GPU・プロジェクトを所有せず、HALF RGBAのブロックだけを受け取る。
 * WASM呼び出しをブロックごとに戻すことで、JS側が進捗・中断を管理できる。 */
typedef struct {
	exr_context *context;
	exr_writer *writer;
	uint16_t *pixels;
	uint16_t *planes;
	uint64_t size, position;
	int width, height, rows_per_block, next_row;
} openexr_encoder;

/* 保存完了を待ってから次のデータを作り、遅い保存先に対して未処理の出力を蓄積しない。
 * ファイル位置はWASM32のポインターとは別の64bit値で持ち、2/4GiB境界で切り詰めない。 */
EM_ASYNC_JS(int, openexr_write_chunk, (const uint8_t *data, size_t length, double position), {
	data >>>= 0; length >>>= 0;
	return await Module['writeChunk'](HEAPU8.subarray(data, data + length), position);
});

static exr_result write_output(void *user, const void *data, size_t length) {
	openexr_encoder *encoder = user;
	/* JSへ正確な位置を渡せる範囲を守り、累積ファイル長をWASM heapから分離する。 */
	if (length > 9007199254740991ULL - encoder->position) return EXR_ERROR_LIMIT_EXCEEDED;
	uint64_t end = encoder->position + length;
	const uint8_t *source = data;
	while (length > 0) {
		size_t bytes = length < OUTPUT_CHUNK_SIZE ? length : OUTPUT_CHUNK_SIZE;
		if (!openexr_write_chunk(source, bytes, (double)encoder->position)) return EXR_ERROR_IO;
		encoder->position += bytes;
		source += bytes;
		length -= bytes;
	}
	if (end > encoder->size) encoder->size = end;
	return EXR_SUCCESS;
}

static exr_result seek_output(void *user, uint64_t position) {
	openexr_encoder *encoder = user;
	if (position > encoder->size) return EXR_ERROR_IO;
	encoder->position = position;
	return EXR_SUCCESS;
}

void openexr_encoder_destroy(openexr_encoder *encoder) {
	if (encoder == NULL) return;
	exr_writer_destroy(encoder->writer);
	exr_context_destroy(encoder->context);
	free(encoder->pixels);
	free(encoder->planes);
	free(encoder);
}

openexr_encoder *openexr_encoder_create(int width, int height, int compression) {
	if (width < 1 || height < 1 ||
		(compression != EXR_COMPRESSION_NONE && compression != EXR_COMPRESSION_ZIP)) return NULL;
	openexr_encoder *encoder = calloc(1, sizeof(*encoder));
	if (encoder == NULL) return NULL;
	encoder->width = width;
	encoder->height = height;
	encoder->rows_per_block = compression == EXR_COMPRESSION_ZIP ? 16 : 1;
	if ((size_t)width > SIZE_MAX / (encoder->rows_per_block * 4 * sizeof(uint16_t))) {
		openexr_encoder_destroy(encoder);
		return NULL;
	}
	size_t bytes = (size_t)width * encoder->rows_per_block * 4 * sizeof(uint16_t);
	encoder->pixels = malloc(bytes);
	encoder->planes = malloc(bytes);
	exr_header header = {0};
	exr_channel channels[4] = {0};
	/* OpenEXRのチャンネルは名前順。画素のRGBA順との対応はwriteで明示する。 */
	const char *names[4] = {"A", "B", "G", "R"};
	for (int channel = 0; channel < 4; channel++) {
		strcpy(channels[channel].name, names[channel]);
		channels[channel].pixel_type = EXR_PIXEL_HALF;
		channels[channel].x_sampling = channels[channel].y_sampling = 1;
	}
	header.part_type = EXR_PART_SCANLINE;
	header.compression = (exr_compression)compression;
	header.data_window.max_x = width - 1;
	header.data_window.max_y = height - 1;
	header.display_window = header.data_window;
	header.pixel_aspect_ratio = 1;
	header.screen_window_width = 1;
	header.num_channels = 4;
	header.channels = channels;
	header.has_chromaticities = 1;
	const float chromaticities[8] = {0.64f, 0.33f, 0.30f, 0.60f, 0.15f, 0.06f, 0.3127f, 0.3290f};
	memcpy(header.chromaticities, chromaticities, sizeof(chromaticities));
	exr_result result = exr_header_set_string_attribute(NULL, &header, "colorInteropID", "lin_rec709_scene");
	if (EXR_OK(result) && encoder->pixels != NULL && encoder->planes != NULL) result = exr_context_create(NULL, &encoder->context);
	else result = EXR_ERROR_OUT_OF_MEMORY;
	/* ブロック単位の画素制限は維持し、既定の1GiBファイル制限だけを外す。
	 * 出力は保存先へ渡すため、ファイル長をWASM heapの上限には結び付けない。 */
	if (EXR_OK(result)) result = exr_context_set_max_file_bytes(encoder->context, 0);
	if (EXR_OK(result)) result = exr_writer_create_ctx(encoder->context, NULL, &encoder->writer);
	if (EXR_OK(result)) result = exr_writer_add_part(encoder->writer, &header, NULL);
	/* add_partはヘッダーを複製する。スタック上のchannelsをfreeしないよう切り離す。 */
	header.channels = NULL;
	header.num_channels = 0;
	exr_header_free(exr_default_allocator(), &header);
	exr_data_sink sink = {encoder, write_output, seek_output, NULL};
	if (EXR_OK(result)) result = exr_writer_begin_stream(encoder->writer, &sink, (exr_compression)compression);
	if (!EXR_OK(result)) { openexr_encoder_destroy(encoder); return NULL; }
	return encoder;
}

uint16_t *openexr_encoder_pixels(openexr_encoder *encoder) { return encoder->pixels; }

int openexr_encoder_write(openexr_encoder *encoder) {
	if (encoder->next_row >= encoder->height) return EXR_ERROR_INVALID_ARGUMENT;
	int rows = encoder->height - encoder->next_row;
	if (rows > encoder->rows_per_block) rows = encoder->rows_per_block;
	size_t count = (size_t)encoder->width * rows;
	exr_const_buffer channels[4];
	for (int channel = 0; channel < 4; channel++) {
		uint16_t *plane = encoder->planes + count * channel;
		/* HALFをfloatへ変換せず並べ替え、HDR・負値・alpha=0の発光をそのまま保存する。 */
		for (size_t pixel = 0; pixel < count; pixel++) plane[pixel] = encoder->pixels[pixel * 4 + 3 - channel];
		channels[channel].data = plane;
		channels[channel].size = count * sizeof(uint16_t);
	}
	exr_result result = exr_writer_write_scanline_block(encoder->writer, 0, encoder->next_row, channels, 4);
	if (EXR_OK(result)) encoder->next_row += rows;
	return result;
}

int openexr_encoder_finish(openexr_encoder *encoder) {
	if (encoder->next_row != encoder->height) return EXR_ERROR_INVALID_ARGUMENT;
	return exr_writer_end_stream(encoder->writer);
}
double openexr_encoder_size(openexr_encoder *encoder) { return (double)encoder->size; }
