import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { StaticSettingDefinitions } from '@gs/shared/static-setting.ts';

export type EffectOutputDefinition = {
	dataType: TextureDataType;
	label?: string;
};

/** 公開入出力のキーは保存・配線用の固定ID。配置の登録IDや実装固有の名前から独立させる。 */
export type EffectDefinition<
	Parameters extends Readonly<Record<string, ParameterDefinition>> = Readonly<Record<string, ParameterDefinition>>,
	Outputs extends Readonly<Record<string, EffectOutputDefinition>> = Readonly<Record<string, EffectOutputDefinition>>,
> = {
	kind: 'generate' | 'modify';
	paramDefs: Parameters;
	outputDefs: Outputs;
	staticSettingDefs?: StaticSettingDefinitions;
	primaryInputParameter: Extract<keyof Parameters, string> | null;
	primaryAudioInputParameter?: Extract<keyof Parameters, string> | null;
	resolutionInputParameters: readonly Extract<keyof Parameters, string>[];
	primaryOutput: Extract<keyof Outputs, string> | null;
};
