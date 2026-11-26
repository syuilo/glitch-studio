import type { EffectLivePreviewMediaBinding } from '@gs/glitch-studio_shared/effect-live-preview-input.ts';
import type { ValueParameterBinding, ParameterExpressionModifier } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { ExpressionVariableName } from '@gs/shared/expression/expression-environment.ts';
import type { NodesEffectParameterBinding } from '@/types/nodes-effect-view.ts';
import type { TimelineEffectParameterBinding } from '@gs/subsystems_timeline_shared/parameter-binding.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';

// 型変更は型・UI・初期値をまとめて差し替える。編集差分ではフィールド間の対応を緩め、
// 保存先のCommandで完成した定義を検証する。
export type PublicParameterDefinitionEdit = Partial<{
	dataType: ParameterDefinition['dataType'];
	ui: ParameterDefinition['ui'];
	defaultValue: ParameterDefinition['defaultValue'];
	canNode: boolean;
	nameForReference: string;
}>;

// 共用エディタだけが複数ドメインの方式を扱う。保存先の型は各ドメインのBindingを使う。
export type EditableTimelineParameterBinding = TimelineEffectParameterBinding;
export type EditableParameterBinding = NodesEffectParameterBinding | EditableTimelineParameterBinding | EffectLivePreviewMediaBinding;

// 入力方式ごとのunionにし、UI側で方式を除外した結果をCommandにも渡せるようにする。
export type ParameterInputSourceEdit<Source extends EditableParameterBinding['inputSource'] = EditableParameterBinding['inputSource']> = {
	[Kind in Source]: { kind: 'inputSource'; inputSource: Kind };
}[Source];

export type ValueParameterEdit =
	| { kind: 'literal'; value: any }
	| { kind: 'curveAnimationInline'; value: Extract<ValueParameterBinding, { inputSource: 'curveAnimationInline' }> }
	| { kind: 'keyframesTimelineInline'; value: Extract<ValueParameterBinding, { inputSource: 'keyframesTimelineInline' }> }
	| { kind: 'envVariable'; value: ExpressionVariableName }
	| { kind: 'expression'; value: string }
	| { kind: 'expressionModifier'; value: ParameterExpressionModifier | null }
	| ParameterInputSourceEdit<ValueParameterBinding['inputSource']>
	| { kind: 'reset' }
	| { kind: 'addElement' }
	| { kind: 'removeElement'; elementId: string };

export type NodesEffectValueParameterEdit = ValueParameterEdit
	| { kind: 'nodesEffectPublicParameterReference'; value: string }
	| { kind: 'nodesEffectCustomParameterValueReference'; value: string }
	| ParameterInputSourceEdit<'nodesEffectPublicParameterReference' | 'nodesEffectCustomParameterValueReference'>;
