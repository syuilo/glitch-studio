import type { StaticSettingValues } from '@gs/shared/static-setting.ts';
import type { EffectSource } from '@gs/subsystems_effect_shared/effect-source.ts';
import type { EffectResolution } from '@gs/subsystems_effect_shared/resolution.ts';
import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { AutomationGraph } from '@gs/shared/automation-graph/automation-graph.ts';
import type { FitMode, WrapMode } from '@gs/shared/types.js';

export type NodesEffectNodeParameterBinding = { inputSource: 'node' } & (NodeOutputReference | { nodeId: null; outputPort: null });

export type NodesEffectPublicParameterReferenceBinding = {
	inputSource: 'nodesEffectPublicParameterReference';
	parameterId: string;
};

export type NodesEffectCustomParameterReferenceBinding = {
	inputSource: 'nodesEffectCustomParameterValueReference';
	parameterId: string;
};

// カスタムパラメータはCPU値だけを共有し、ノードの画像配線は所有しない。
export type NodesEffectValueParameterBinding = ValueParameterBinding | NodesEffectPublicParameterReferenceBinding | NodesEffectCustomParameterReferenceBinding;

// Nodes Effect内部でだけ解決できる参照を、共通の値入力に加える。
export type NodesEffectParameterBinding = NodesEffectValueParameterBinding | NodesEffectNodeParameterBinding;

export type NodesEffectEffectNode = {
	id: string;
	type: 'effect';
	effectSource: EffectSource;
	isBypass: boolean;
	resolution: EffectResolution;
	params: Record<string, NodesEffectParameterBinding>;
	staticSettings: StaticSettingValues;

	displayName: string;

	// 2D平面上でノードを配置できるようになった時のため
	pos?: { x: number; y: number };
};

export type NodesEffectGlobalInNode = {
	id: string;
	type: 'globalIn';

	// 2D平面上でノードを配置できるようになった時のため
	pos?: { x: number; y: number };
};

export type NodesEffectGlobalOutNode = {
	id: string;
	type: 'globalOut';
	// キーはNodesEffect.outputDefsのID。未設定のポートは未接続として扱う。
	inputs: Record<string, { nodeId: string; outputPort: string } | { nodeId: null; outputPort: null }>;

	// 2D平面上でノードを配置できるようになった時のため
	pos?: { x: number; y: number };
};

export type NodesEffectRelayNode = {
	id: string;
	type: 'relay';
	label?: string;
	// 入出力の宣言型。接続時の互換性判定に使い、レンダラーでは型の強制や変換を行わない。
	dataType: TextureDataType;
	input: { nodeId: string; outputPort: string } | { nodeId: null; outputPort: null };
	pos?: { x: number; y: number };
};

export type NodesEffectNode = NodesEffectEffectNode | NodesEffectGlobalInNode | NodesEffectGlobalOutNode | NodesEffectRelayNode;

export type NodesEffectOutputDef = {
	id: string;
	label: string;
	name: string;
	dataType: TextureDataType;
};

export type NodesEffectParamDef = ParameterDefinition & {
	id: string;
	nameForReference: string; // expressionから参照するとき用
	// ParameterDefinitionでノード入力を許可する型だけ、Inノードの出力として公開できる。
	canNode: boolean;
};

export type NodesEffectCustomParameterDefinition = Extract<ParameterDefinition, { dataType: { kind: 'scalar' | 'bool' | 'string' | 'color' | 'vector' | 'enum' | 'colorRamp' | 'sizeReference' } }> & {
	id: string;
	nameForReference: string;
	canNode: false;
};

/** In/Outとポートの並びを編集するための表示モデル。プロジェクトにはEffect定義を保存する。 */
export type NodesEffect = {
	resolutionInputParameters: string[];
	nodes: NodesEffectNode[];
	outputDefs: NodesEffectOutputDef[];
	primaryOutputId: string | null;
	paramDefs: NodesEffectParamDef[];
	/** 内部の共通値。未使用時も空の配列・オブジェクトを持ち、公開引数には含めない。 */
	customParameterDefs: NodesEffectCustomParameterDefinition[];
	customParameterValues: Record<string, NodesEffectValueParameterBinding>;
	primaryInputId: string | null;
	/** 音声の自動割当先。Inノードの画像入力とは独立する。 */
	primaryAudioInputId?: string | null;
	automationGraphs: AutomationGraph[];
};

// レイヤー・Effect Live Previewからは、Nodes Effect内部のノードやパラメータを参照しない。
export type NodesEffectArgumentBindings = Record<string, ValueParameterBinding>;

export type NodeOutputReference = { nodeId: string; outputPort: string; fitMode: FitMode; wrapMode: WrapMode; filterMode: 'linear' | 'nearest' };
