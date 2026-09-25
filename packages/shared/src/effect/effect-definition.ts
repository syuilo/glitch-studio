import type { TextureDataType } from '../data-type.ts';
import type { ParameterDefinition } from '../parameter.ts';

export type EffectOutputDefinitions = Record<string, {
	dataType: TextureDataType;
	primary: boolean;

	// trueの出力のみ、必要になるまで確保を遅らせ、未使用になったら解放する。
	canLazyAllocation?: boolean;
}>;

export type EffectTags = string; // TODO

export type EffectDefinition<In extends Record<string, ParameterDefinition> = Record<string, ParameterDefinition>, Out extends EffectOutputDefinitions = EffectOutputDefinitions> = {
	id: string;
	displayName: string;
	tags: EffectTags[];
	paramDefs: In;
	outputDefs: Out;
};

export function defineEffect<const In extends Record<string, ParameterDefinition>, const Out extends EffectOutputDefinitions>(
	def: EffectDefinition<In, Out>,
): EffectDefinition<In, Out> {
	return def;
}
