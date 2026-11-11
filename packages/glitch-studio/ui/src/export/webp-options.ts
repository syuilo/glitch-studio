import type { WebpStillExportSettings } from './timeline-export.ts';

export function getWebpOptions(quality: WebpStillExportSettings['quality']) {
	return {
		lossless: quality === 'lossless',
		quality: quality === 'lossless' ? 75 : {
			low: 40,
			medium: 65,
			high: 85,
			'very-high': 95,
		}[quality],
	};
}
