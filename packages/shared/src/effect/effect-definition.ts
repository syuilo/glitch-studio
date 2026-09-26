import type { TextureDataType } from '../data-type.ts';
import type { CheckedParameterDefinition, ParameterDefinition } from '../parameter.ts';

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
	// バイパス・自動接続に使うトップレベルの入力。主入力がないエフェクトはnull。
	primaryInputParameter: Extract<keyof In, string> | null;
	outputDefs: Out;
};

export function defineEffect<const In extends Record<string, ParameterDefinition>, const Out extends EffectOutputDefinitions>(
	def: EffectDefinition<In, Out> & {
		paramDefs: { [K in keyof In]: CheckedParameterDefinition<NoInfer<In[K]>> };
	},
): EffectDefinition<In, Out> {
	// 主入力は接続を受け取るため、通常の数値設定やコンテナは指定できない。
	if (def.primaryInputParameter !== null && def.paramDefs[def.primaryInputParameter]?.canNode !== true) {
		throw new Error(`Primary input must reference a node-capable parameter: ${def.id}.${def.primaryInputParameter}`);
	}
	return def;
}
