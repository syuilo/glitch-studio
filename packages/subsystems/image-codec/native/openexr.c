#include "exr.h"
#include "exr_internal.h"
#include <stdlib.h>
#include <string.h>

/* 画像・GPU・プロジェクトを所有せず、HALF RGBAのブロックだけを受け取る。
 * WASM呼び出しをブロックごとに戻すことで、JS側が進捗・中断を管理できる。 */
typedef struct {
	exr_writer *writer;
	uint16_t *pixels;
	uint16_t *planes;
	uint8_t *output;
	size_t size, capacity, position;
	int width, height, rows_per_block, next_row;
} openexr_encoder;

static exr_result write_output(void *user, const void *data, size_t length) {
	openexr_encoder *encoder = user;
	if (length > SIZE_MAX - encoder->position) return EXR_ERROR_LIMIT_EXCEEDED;
	size_t end = encoder->position + length;
	if (end > encoder->capacity) {
		size_t capacity = encoder->capacity > 0 ? encoder->capacity : 4096;
		while (capacity < end) {
			if (capacity > SIZE_MAX / 2) return EXR_ERROR_LIMIT_EXCEEDED;
			capacity *= 2;
		}
		void *output = realloc(encoder->output, capacity);
		if (output == NULL) return EXR_ERROR_OUT_OF_MEMORY;
		encoder->output = output;
		encoder->capacity = capacity;
	}
	memcpy(encoder->output + encoder->position, data, length);
	encoder->position = end;
	if (end > encoder->size) encoder->size = end;
	return EXR_SUCCESS;
}

static exr_result seek_output(void *user, uint64_t position) {
	openexr_encoder *encoder = user;
	if (position > encoder->size) return EXR_ERROR_IO;
	encoder->position = (size_t)position;
	return EXR_SUCCESS;
}

void openexr_encoder_destroy(openexr_encoder *encoder) {
	if (encoder == NULL) return;
	exr_writer_destroy(encoder->writer);
	free(encoder->pixels);
	free(encoder->planes);
	free(encoder->output);
	free(encoder);
}

openexr_encoder *openexr_encoder_create(int width, int height, int compression) {
	if (width < 1 || height < 1 || width > 8192 || height > 8192 ||
		(compression != EXR_COMPRESSION_NONE && compression != EXR_COMPRESSION_ZIP)) return NULL;
	openexr_encoder *encoder = calloc(1, sizeof(*encoder));
	if (encoder == NULL) return NULL;
	encoder->width = width;
	encoder->height = height;
	encoder->rows_per_block = compression == EXR_COMPRESSION_ZIP ? 16 : 1;
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
	if (EXR_OK(result) && encoder->pixels != NULL && encoder->planes != NULL) result = exr_writer_create(NULL, &encoder->writer);
	else result = EXR_ERROR_OUT_OF_MEMORY;
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
uint8_t *openexr_encoder_data(openexr_encoder *encoder) { return encoder->output; }
size_t openexr_encoder_size(openexr_encoder *encoder) { return encoder->size; }
