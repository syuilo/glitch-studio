import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { CheckedParameterDefinition, ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { CheckedStaticSettingDefinition, StaticSettingDefinitions } from '@gs/shared/static-setting.ts';

export type EffectOutputDefinition = {
	dataType: TextureDataType;
	label?: string;
};

// パラメータと出力のキーは表示名から独立した固定ID。配置側はこのIDでBindingと接続を保存する。
// 登録IDは参照元だけに必要で、インラインの定義にもあるという前提をここへ持ち込まない。
export type EffectDefinition<
	Parameters extends Record<string, ParameterDefinition> = Record<string, ParameterDefinition>,
	Outputs extends Record<string, EffectOutputDefinition> = Record<string, EffectOutputDefinition>,
	Settings extends StaticSettingDefinitions = StaticSettingDefinitions,
> = {
	kind: 'generate' | 'modify';
	paramDefs: Parameters;
	outputDefs: Outputs;
	staticSettingDefs?: Settings;
	primaryInputParameter: Extract<keyof Parameters, string> | null;
	primaryAudioInputParameter?: Extract<keyof Parameters, string> | null;
	primaryOutput: Extract<keyof Outputs, string> | null;
	resolutionInputParameters: readonly Extract<keyof Parameters, string>[];
};

export type NativeEffectDefinition<
	Parameters extends Record<string, ParameterDefinition> = Record<string, ParameterDefinition>,
	Outputs extends Record<string, EffectOutputDefinition> = Record<string, EffectOutputDefinition>,
	Settings extends StaticSettingDefinitions = StaticSettingDefinitions,
> = EffectDefinition<Parameters, Outputs, Settings> & {
	id: string;
	displayName: string;
	summary?: Record<'ja-JP' | 'en-US', string>;
};

type NodeInputKey<Parameters> = Extract<{
	[Key in keyof Parameters]: Parameters[Key] extends { canNode: true } ? Key : never;
}[keyof Parameters], string>;

type AudioInputKey<Parameters> = Extract<{
	[Key in keyof Parameters]: Parameters[Key] extends { dataType: { kind: 'audioSource' } } ? Key : never;
}[keyof Parameters], string>;

type HasResolutionInput<Setting> = Setting extends { canNode: true } ? true :
	Setting extends { element: infer Element } ? HasResolutionInput<Element> :
		Setting extends { fields: infer Fields } ? true extends {
			[Key in keyof Fields]: HasResolutionInput<Fields[Key]>;
		}[keyof Fields] ? true : false : false;

type ResolutionInputKey<Parameters> = Extract<{
	[Key in keyof Parameters]: HasResolutionInput<Parameters[Key]> extends true ? Key : never;
}[keyof Parameters], string>;

/** Native Effectの実装から具体的なキーを参照できるよう、定義時の型を保持する。 */
export function defineNativeEffect<
	const Id extends string,
	const Parameters extends Record<string, ParameterDefinition>,
	const Outputs extends Record<string, EffectOutputDefinition>,
	const Settings extends StaticSettingDefinitions = Record<never, never>,
>(definition: NativeEffectDefinition<Parameters, Outputs, Settings> & {
	id: Id;
	paramDefs: { [Key in keyof Parameters]: CheckedParameterDefinition<NoInfer<Parameters[Key]>> };
	staticSettingDefs?: { [Key in keyof Settings]: CheckedStaticSettingDefinition<NoInfer<Settings[Key]>> };
	primaryInputParameter: NodeInputKey<NoInfer<Parameters>> | null;
	primaryAudioInputParameter?: AudioInputKey<NoInfer<Parameters>> | null;
	primaryOutput: Extract<keyof NoInfer<Outputs>, string> | null;
	resolutionInputParameters: readonly ResolutionInputKey<NoInfer<Parameters>>[];
}): NativeEffectDefinition<Parameters, Outputs, Settings> & { id: Id } {
	return definition;
}
