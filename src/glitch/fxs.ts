import { fx } from './core';
import swap from './fx/swap';
import tear from './fx/tear';
import tearBulk from './fx/tear-bulk';
import blur from './fx/blur';

export const fxs = {
	swap, tear, tearBulk, blur
} as Record<string, {
	name: string;
	paramDef: any;
	fn: ReturnType<typeof fx>;
}>;
