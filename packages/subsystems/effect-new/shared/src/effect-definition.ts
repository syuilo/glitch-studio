import type { LeafDataType, TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { StaticSettingDefinitions } from '@gs/shared/static-setting.ts';

// この基盤で評価できるリテラル値と空間入力。コンテナ内のBindingや音声の取得元は別の評価契約を必要とする。
export type EffectParameterDefinition = ParameterDefinition<Exclude<LeafDataType, { kind: 'audioSource' }>>;

export type EffectOutputDefinition = {
	dataType: TextureDataType;
	label?: string;
};

// レコードのキーは入出力の固定ID。表示名・WGSL名を変更しても既存の配線を維持する。
// 定義全体の登録IDは利用側のカタログに属し、インラインで配置する定義には必要ない。
export type EffectDefinition<
	Parameters extends Record<string, EffectParameterDefinition> = Record<string, EffectParameterDefinition>,
	Outputs extends Record<string, EffectOutputDefinition> = Record<string, EffectOutputDefinition>,
> = {
	kind: 'generate' | 'modify';
	paramDefs: Parameters;
	outputDefs: Outputs;
	primaryInputId: Extract<keyof Parameters, string> | null;
	primaryOutputId: Extract<keyof Outputs, string> | null;
	staticSettingDefs?: StaticSettingDefinitions;
};
