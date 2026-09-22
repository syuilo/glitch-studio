import type { StillExportSettings } from './timeline-export.ts';

export function getWebpOptions(quality: StillExportSettings['quality']) {
	return {
		lossless: quality === 'lossless' ? 1 : 0,
		quality: quality === 'lossless' ? 75 : { low: 40, medium: 65, high: 85, 'very-high': 95 }[quality],
		near_lossless: 100,
		exact: 1,
	};
}
