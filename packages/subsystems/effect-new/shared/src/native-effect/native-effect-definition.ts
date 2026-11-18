import type { EffectDefinition } from '../effect-definition.ts';

export type NativeEffectDefinition = EffectDefinition & {
	id: string;
	displayName: string;
	kind: 'generate' | 'modify';
	summary: Record<'ja-JP' | 'en-US', string>;
};
