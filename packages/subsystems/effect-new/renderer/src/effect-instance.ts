import type { DataType } from '@gs/shared/data-type/data-type.ts';
import type { ShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { UniformOrTexture } from '@gs/shared/gpu/uniform-or-texture.ts';
import type { ParameterDefaultValue } from '@gs/shared/parameter/parameter-definition.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { StaticSettingValues } from '@gs/shared/static-setting.ts';
import type { EffectDefinition } from '@gs/subsystems_effect-new_shared/effect-definition.ts';

/** 各配置で固定する入力の表現。配列・構造体では評価済みの値と同じ形で末端を指定し、CPU値はnullとする。 */
export type EffectInputKind = ShaderInput['kind'] | null | readonly EffectInputKind[] | { readonly [field: string]: EffectInputKind };

/** 配置の寿命中に固定する情報。公開入力に固有寸法があるときだけ inputResolutions に渡す。 */
export type EffectInstanceOptions = {
	device: GPUDevice;
	resolution: Resolution;
	inputKinds: Readonly<Record<string, EffectInputKind>>;
	inputResolutions?: ReadonlyMap<string, Resolution | null>;
	enable32bitDataTextures?: boolean;
	staticSettings?: StaticSettingValues;
};

type EvaluatedParameter<Data extends DataType, Settings> =
	Settings extends { canNode: true } ? ShaderInput :
	Data extends { kind: 'array'; elementType: infer Element extends DataType }
		? Settings extends { element: infer Child } ? readonly EvaluatedParameter<Element, Child>[] : never :
	Data extends { kind: 'struct'; fields: infer Fields extends Record<string, DataType> }
		? Settings extends { fields: infer Children } ? { readonly [Key in keyof Fields & keyof Children]: EvaluatedParameter<Fields[Key], Children[Key]> } : never :
	Data extends { kind: 'audioSource' } ? unknown : ParameterDefaultValue<Data>['value'];

/** 静的なNative Effect定義ではキーと値を推論する。実行時に読み込む定義の値は利用側で解釈する。 */
export type EvaluatedEffectParameters<Definition extends EffectDefinition> =
	string extends keyof Definition['paramDefs'] ? Readonly<Record<string, unknown>> : {
		readonly [Key in keyof Definition['paramDefs']]: EvaluatedParameter<Definition['paramDefs'][Key]['dataType'], Definition['paramDefs'][Key]>;
	};

export type EffectRenderContext<Definition extends EffectDefinition = EffectDefinition> = {
	commandEncoder: GPUCommandEncoder;
	/** 全公開入力の評価済みの値。接続可能な値は定数・画像とも ShaderInput で渡す。 */
	params: EvaluatedEffectParameters<Definition>;
	requestedOutputIds: ReadonlySet<string>;
	/** 絶対時刻は秒、前回の描画からの経過時間はミリ秒。 */
	time: number;
	timeDelta: number;
};

export interface EffectInstance<Definition extends EffectDefinition = EffectDefinition> {
	/** 配置の寿命中は固定。未接続のポートはnull、接続済みのポートは描画前から表現を公開する。 */
	getOutputKind(outputId: string): UniformOrTexture['kind'] | null;
	/** 描画前にも問い合わせ可能。定数や未接続のポートには固有の解像度がない。 */
	getOutputResolution(outputId: string): Resolution | null;
	/**
	 * 1回の評価で必要な全ポートを渡す。生成したコマンドは呼び出し側の encoder に記録する。
	 * 借用した出力の読み取りと submit は、同じ配置の次の描画・破棄より前に行う。
	 * 要求された接続済みポートには getOutputKind と同じ種類の値を返す。未接続の出力は結果に含めない。
	 */
	render(context: EffectRenderContext<Definition>): ReadonlyMap<string, UniformOrTexture>;
	dispose(): void;
}

/** カタログには配置ごとの生成関数を登録し、複数配置の履歴や所有リソースを分離する。 */
export type NativeEffectImplementation<Definition extends EffectDefinition = EffectDefinition> =
	(options: EffectInstanceOptions) => EffectInstance<Definition> | Promise<EffectInstance<Definition>>;
