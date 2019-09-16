import { fx } from './core';
import swap from './fx/swap';
import tear from './fx/tear';
import tearBulk from './fx/tear-bulk';
import blur from './fx/blur';
import channelShift from './fx/channel-shift';

export const fxs = {
	swap, tear, tearBulk, blur, channelShift
} as Record<string, {
	name: string;
	displayName: string;
	paramDef: any;
	fn: ReturnType<typeof fx>;
}>;
