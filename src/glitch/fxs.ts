import { fx, ParamDefs } from './core';
import swap from './fx/swap';
import tear from './fx/tear';
import tearBulk from './fx/tear-bulk';
import blur from './fx/blur';
import channelShift from './fx/channel-shift';
import colorBlocks from './fx/color-blocks';
import replace from './fx/replace';

export const fxs = {
	swap, tear, tearBulk, blur, channelShift, colorBlocks, replace
} as Record<string, {
	name: string;
	displayName: string;
	paramDefs: ParamDefs;
	fn: ReturnType<typeof fx>;
}>;
