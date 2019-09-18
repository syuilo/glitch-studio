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

export const fxs = {
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
} as Record<string, {
	name: string;
	displayName: string;
	paramDefs: ParamDefs;
	fn: ReturnType<typeof fx>;
}>;
