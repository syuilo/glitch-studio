import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { CheckedParameterDefinition, ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';

export type EffectOutputDefinitions = Record<string, {
	dataType: TextureDataType;

	// trueの出力のみ、必要になるまで確保を遅らせ、未使用になったら解放する。
	canLazyAllocation?: boolean;
}>;

export type EffectTags = string; // TODO

export type EffectDefinition<In extends Record<string, ParameterDefinition> = Record<string, ParameterDefinition>, Out extends EffectOutputDefinitions = EffectOutputDefinitions> = {
	id: string;
	displayName: string;
	// レイヤー作成時の主入力と合成方法を決める。入力の有無からは推測しない。
	kind: 'modify' | 'generate';
	tags: EffectTags[];
	paramDefs: In;
	// バイパス・自動接続に使うトップレベルの入力。主入力がないエフェクトはnull。
	primaryInputParameter: Extract<keyof In, string> | null;
	// 自動解像度の基準。バイパスの主入力とは独立した役割で、nullなら描画先を使う。
	resolutionInputParameter: Extract<keyof In, string> | null;
	outputDefs: Out;
	primaryOutput: Extract<keyof NoInfer<Out>, string> | null;
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
	if (def.primaryOutput !== null && !Object.hasOwn(def.outputDefs, def.primaryOutput)) {
		throw new Error(`Primary output must reference an existing output: ${def.id}.${def.primaryOutput}`);
	}
	if (def.resolutionInputParameter !== null && def.paramDefs[def.resolutionInputParameter]?.canNode !== true) {
		throw new Error(`Resolution input must reference a node-capable parameter: ${def.id}.${def.resolutionInputParameter}`);
	}
	return def;
}
