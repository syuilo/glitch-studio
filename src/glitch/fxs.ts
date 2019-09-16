import { fx } from './core';
import swap from './fx/swap';
import tear from './fx/tear';
import tearBulk from './fx/tear-bulk';
import blur from './fx/blur';
import channelShift from './fx/channel-shift';
import colorBlocks from './fx/color-blocks';

export const fxs = {
	swap, tear, tearBulk, blur, channelShift, colorBlocks
} as Record<string, {
	name: string;
	displayName: string;
	paramDef: Record<string, any>;
	fn: ReturnType<typeof fx>;
}>;
