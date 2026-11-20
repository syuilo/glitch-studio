import type { StaticSettingValues } from '@gs/shared/static-setting.ts';
import type { EffectSource } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import type { EffectResolution } from '@gs/subsystems_effect-new_shared/resolution.ts';
import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { EffectParameterDefinition } from '@gs/subsystems_effect-new_shared/effect-definition.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { AutomationGraph } from '@gs/shared/automation-graph/automation-graph.ts';
import type { FitMode, WrapMode } from '@gs/shared/types.js';

export type CustomNodeGraphEffectNodeParameterBinding = { inputSource: 'node' } & (NodeOutputReference | { nodeId: null; outputPort: null });

export type CustomNodeGraphEffectPublicParameterReferenceBinding = {
	inputSource: 'customNodeGraphEffectPublicParameterReference';
	parameterId: string;
};

export type CustomNodeGraphEffectCustomParameterReferenceBinding = {
	inputSource: 'customNodeGraphEffectCustomParameterValueReference';
	parameterId: string;
};

// カスタムパラメータはCPU値だけを共有し、ノードの画像配線は所有しない。
export type CustomNodeGraphEffectValueParameterBinding = ValueParameterBinding | CustomNodeGraphEffectPublicParameterReferenceBinding | CustomNodeGraphEffectCustomParameterReferenceBinding;

// Custom Node Graph Effect内部でだけ解決できる参照を、共通の値入力に加える。
export type CustomNodeGraphEffectParameterBinding = CustomNodeGraphEffectValueParameterBinding | CustomNodeGraphEffectNodeParameterBinding;

export type CustomNodeGraphEffectEffectNode = {
	id: string;
	type: 'effect';
	effectSource: EffectSource;
	isBypass: boolean;
	resolution: EffectResolution;
	params: Record<string, CustomNodeGraphEffectParameterBinding>;
	staticSettings: StaticSettingValues;

	displayName: string;

	// 2D平面上でノードを配置できるようになった時のため
	pos?: { x: number; y: number };
};

export type CustomNodeGraphEffectGlobalInNode = {
	id: string;
	type: 'globalIn';

	// 2D平面上でノードを配置できるようになった時のため
	pos?: { x: number; y: number };
};

export type CustomNodeGraphEffectGlobalOutNode = {
	id: string;
	type: 'globalOut';
	// キーはCustomNodeGraphEffect.outputDefsのID。未設定のポートは未接続として扱う。
	inputs: Record<string, { nodeId: string; outputPort: string } | { nodeId: null; outputPort: null }>;

	// 2D平面上でノードを配置できるようになった時のため
	pos?: { x: number; y: number };
};

export type CustomNodeGraphEffectRelayNode = {
	id: string;
	type: 'relay';
	label?: string;
	// 入出力の宣言型。接続時の互換性判定に使い、レンダラーでは型の強制や変換を行わない。
	dataType: TextureDataType;
	input: { nodeId: string; outputPort: string } | { nodeId: null; outputPort: null };
	pos?: { x: number; y: number };
};

export type CustomNodeGraphEffectNode = CustomNodeGraphEffectEffectNode | CustomNodeGraphEffectGlobalInNode | CustomNodeGraphEffectGlobalOutNode | CustomNodeGraphEffectRelayNode;

export type CustomNodeGraphEffectOutputDef = {
	id: string;
	label: string;
	name: string;
	dataType: TextureDataType;
};

export type CustomNodeGraphEffectParamDef = EffectParameterDefinition & {
	id: string;
	nameForReference: string; // expressionから参照するとき用
	// ParameterDefinitionでノード入力を許可する型だけ、Inノードの出力として公開できる。
	canNode: boolean;
};

export type CustomNodeGraphEffectCustomParameterDefinition = Extract<EffectParameterDefinition, { dataType: { kind: 'scalar' | 'bool' | 'string' | 'color' | 'vector' | 'enum' | 'colorRamp' | 'sizeReference' } }> & {
	id: string;
	nameForReference: string;
	canNode: false;
};

/** In/Outとポートの並びを編集するための表示モデル。プロジェクトにはEffect定義を保存する。 */
export type CustomNodeGraphEffect = {
	resolutionInputParameters: string[];
	nodes: CustomNodeGraphEffectNode[];
	outputDefs: CustomNodeGraphEffectOutputDef[];
	primaryOutputId: string | null;
	paramDefs: CustomNodeGraphEffectParamDef[];
	/** 内部の共通値。未使用時も空の配列・オブジェクトを持ち、公開引数には含めない。 */
	customParameterDefs: CustomNodeGraphEffectCustomParameterDefinition[];
	customParameterValues: Record<string, CustomNodeGraphEffectValueParameterBinding>;
	primaryInputId: string | null;
	/** 音声の自動割当先。Inノードの画像入力とは独立する。 */
	primaryAudioInputId?: string | null;
	automationGraphs: AutomationGraph[];
};

// レイヤー・Effect Live Previewからは、Custom Node Graph Effect内部のノードやパラメータを参照しない。
export type CustomNodeGraphEffectArgumentBindings = Record<string, ValueParameterBinding>;

export type NodeOutputReference = { nodeId: string; outputPort: string; fitMode: FitMode; wrapMode: WrapMode; filterMode: 'linear' | 'nearest' };
