import { WebpEncoder } from '@gs/subsystems_image-codec/webp-encoder.ts';
import { getWebpOptions } from './webp-options.ts';
import type { SrgbImageReadback } from '@gs/glitch-studio_renderer/srgb-image-readback.ts';
import type { WebpStillExportSettings } from './timeline-export.ts';

/** 画像全体のJavaScript配列を作らず、コーデックが所有する一枚へ画素を取り込む。 */
export async function prepareStillWebp(image: SrgbImageReadback, settings: WebpStillExportSettings, signal: AbortSignal): Promise<WebpEncoder> {
	const encoder = await WebpEncoder.create({ width: image.width, height: image.height, ...getWebpOptions(settings.quality) });
	try {
		for await (const block of image.readBlocks(encoder.rowsPerBlock, signal)) encoder.writeBlock(block);
		signal.throwIfAborted();
		return encoder;
	} catch (error) {
		encoder.dispose();
		throw error;
	}
}
