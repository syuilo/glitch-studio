import { fx, ParamDefs } from './core';
import swap from './fx/swap';
import tearing from './fx/tearing';
import tearings from './fx/tearings';
import blur from './fx/blur';
import channelShift from './fx/channel-shift';
import colorBlocks from './fx/color-blocks';
import replace from './fx/replace';
import crt from './fx/crt';
import fill from './fx/fill';
import threshold from './fx/threshold';
import blockStretch from './fx/block-stretch';
import continuousGhost from './fx/continuous-ghost';
import pixelSort from './fx/pixel-sort';
import noise from './fx/noise';
import granular from './fx/granular';
import distortion from './fx/distortion';
import grayscale from './fx/grayscale';
import overlay from './fx/overlay';
import copy from './fx/copy';
import lcd from './fx/lcd';
import pixelate from './fx/pixelate';
import levels from './fx/levels';
import colorRange_2 from './fx/color-range';
import colorRange from './fx/legacy/color-range';

const _fxs = {
	swap,
	tearing,
	tearings,
	blur,
	channelShift,
	colorBlocks,
	replace,
	crt,
	fill,
	threshold,
	blockStretch,
	continuousGhost,
	pixelSort,
	noise,
	granular,
	distortion,
	grayscale,
	overlay,
	copy,
	lcd,
	pixelate,
	levels,
	colorRange_2,
	colorRange,
} as Record<string, {
	name: string;
	displayName: string;
	paramDefs: ParamDefs;
	fn: ReturnType<typeof fx>;
}>;

const fxs = {} as typeof _fxs;
Object.keys(_fxs).sort().forEach(key => {
	fxs[key] = _fxs[key];
});

export { fxs };
