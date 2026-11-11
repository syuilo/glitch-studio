#include "exr.h"
#include "exr_internal.h"
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
	uint8_t **output_chunks;
	size_t size, position, chunk_count;
	int width, height, rows_per_block, next_row;
} openexr_encoder;

static exr_result reserve_output(openexr_encoder *encoder, size_t end) {
	/* 巨大な連続領域をreallocすると旧領域と新領域が同時に必要になり、出力が
	 * 1GiB程度でもWASM32の上限に達し得る。固定長のchunkで出力を保持し、
	 * 最後にJSが独立したArrayBufferへコピーする。offset tableの書き戻しも
	 * 同じchunkへ行うため、ストリーム出力のseek契約はそのまま維持できる。 */
	size_t count = end / OUTPUT_CHUNK_SIZE + (end % OUTPUT_CHUNK_SIZE != 0);
	if (count > encoder->chunk_count) {
		void *chunks = realloc(encoder->output_chunks, count * sizeof(uint8_t *));
		if (chunks == NULL) return EXR_ERROR_OUT_OF_MEMORY;
		encoder->output_chunks = chunks;
		while (encoder->chunk_count < count) {
			uint8_t *chunk = malloc(OUTPUT_CHUNK_SIZE);
			if (chunk == NULL) return EXR_ERROR_OUT_OF_MEMORY;
			encoder->output_chunks[encoder->chunk_count++] = chunk;
		}
	}
	return EXR_SUCCESS;
}

static exr_result write_output(void *user, const void *data, size_t length) {
	openexr_encoder *encoder = user;
	if (length > SIZE_MAX - encoder->position) return EXR_ERROR_LIMIT_EXCEEDED;
	size_t end = encoder->position + length;
	exr_result result = reserve_output(encoder, end);
	if (!EXR_OK(result)) return result;
	const uint8_t *source = data;
	while (length > 0) {
		size_t chunk = encoder->position / OUTPUT_CHUNK_SIZE;
		size_t offset = encoder->position % OUTPUT_CHUNK_SIZE;
		size_t bytes = OUTPUT_CHUNK_SIZE - offset;
		if (bytes > length) bytes = length;
		memcpy(encoder->output_chunks[chunk] + offset, source, bytes);
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
	encoder->position = (size_t)position;
	return EXR_SUCCESS;
}

void openexr_encoder_destroy(openexr_encoder *encoder) {
	if (encoder == NULL) return;
	exr_writer_destroy(encoder->writer);
	exr_context_destroy(encoder->context);
	free(encoder->pixels);
	free(encoder->planes);
	for (size_t chunk = 0; chunk < encoder->chunk_count; chunk++) free(encoder->output_chunks[chunk]);
	free(encoder->output_chunks);
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
	 * 出力長はwrite_outputのsize_t検証と、WASMの利用可能メモリで制限される。 */
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
uint8_t *openexr_encoder_data(openexr_encoder *encoder, size_t offset) {
	if (offset >= encoder->size) return NULL;
	return encoder->output_chunks[offset / OUTPUT_CHUNK_SIZE] + offset % OUTPUT_CHUNK_SIZE;
}
size_t openexr_encoder_chunk_size(void) { return OUTPUT_CHUNK_SIZE; }
size_t openexr_encoder_size(openexr_encoder *encoder) { return encoder->size; }
