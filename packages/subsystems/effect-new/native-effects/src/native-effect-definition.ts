import type { EffectDefinition, EffectOutputDefinition } from '@gs/subsystems_effect-new_shared/effect-definition.ts';
import type { CheckedParameterDefinition, ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';

/** 固定の登録IDと検索用メタデータはNative Effectのカタログが所有する。 */
export type NativeEffectDefinition<
	Parameters extends Readonly<Record<string, ParameterDefinition>> = Readonly<Record<string, ParameterDefinition>>,
	Outputs extends Readonly<Record<string, EffectOutputDefinition>> = Readonly<Record<string, EffectOutputDefinition>>,
> = EffectDefinition<Parameters, Outputs> & {
	id: string;
	displayName: string;
	summary: Record<'ja-JP' | 'en-US', string>;
	tags: readonly string[];
	dependsOnRenderHistory: boolean;
};

export function defineNativeEffect<
	const Parameters extends Readonly<Record<string, ParameterDefinition>>,
	const Outputs extends Readonly<Record<string, EffectOutputDefinition>>,
>(definition: NativeEffectDefinition<Parameters, Outputs> & {
	paramDefs: { [Key in keyof Parameters]: CheckedParameterDefinition<NoInfer<Parameters[Key]>> };
}): NativeEffectDefinition<Parameters, Outputs> {
	return definition;
}
