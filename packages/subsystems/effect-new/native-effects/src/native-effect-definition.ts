import type { EffectDefinition } from '@gs/subsystems_effect-new_shared/effect-definition.ts';

/** Native Effect 一覧が提供する表示情報。登録IDはカタログのキーが所有する。 */
export type NativeEffectDefinition = EffectDefinition & {
	displayName: string;
	summary: Record<'ja-JP' | 'en-US', string>;
	tags: readonly string[];
};
