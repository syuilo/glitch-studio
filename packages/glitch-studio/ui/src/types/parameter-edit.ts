import type { ValueParameterBinding, ParameterExpressionModifier } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { AutomationGraphPlaybackOptions } from '@gs/shared/automation-graph/automation-graph.ts';
import type { ExpressionVariableName } from '@gs/shared/expression/expression-environment.ts';
import type { VisualModuleParameterBinding } from '@gs/subsystems_visual-module_shared/types.ts';
import type { TimelineEffectParameterBinding, TimelineVisualModuleParameterBinding } from '@gs/subsystems_timeline_shared/parameter-binding.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';

// 型変更は型・UI・初期値をまとめて差し替える。編集差分ではフィールド間の対応を緩め、
// 保存先のCommandで完成した定義を検証する。
export type CustomParameterDefinitionEdit = Partial<{
	dataType: ParameterDefinition['dataType'];
	ui: ParameterDefinition['ui'];
	defaultValue: ParameterDefinition['defaultValue'];
	canNode: boolean;
	nameForReference: string;
}>;

// 共用エディタだけが複数ドメインの方式を扱う。保存先の型は各ドメインのBindingを使う。
export type EditableTimelineParameterBinding = TimelineEffectParameterBinding | TimelineVisualModuleParameterBinding;
export type EditableParameterBinding = VisualModuleParameterBinding | EditableTimelineParameterBinding;

// 入力方式ごとのunionにし、UI側で方式を除外した結果をCommandにも渡せるようにする。
export type ParameterInputSourceEdit<Source extends EditableParameterBinding['inputSource'] = EditableParameterBinding['inputSource']> = {
	[Kind in Source]: { kind: 'inputSource'; inputSource: Kind };
}[Source];

export type ValueParameterEdit =
	| { kind: 'literal'; value: any }
	| { kind: 'automationGraphInline'; value: Extract<ValueParameterBinding, { inputSource: 'automationGraphInline' }> }
	| { kind: 'keyframesTimelineInline'; value: Extract<ValueParameterBinding, { inputSource: 'keyframesTimelineInline' }> }
	| { kind: 'envVariable'; value: ExpressionVariableName }
	| { kind: 'expression'; value: string }
	| { kind: 'expressionModifier'; value: ParameterExpressionModifier | null }
	| { kind: 'automationGraphReference'; value: string | null; options?: Partial<AutomationGraphPlaybackOptions> }
	| ParameterInputSourceEdit<ValueParameterBinding['inputSource']>
	| { kind: 'reset' }
	| { kind: 'addElement' }
	| { kind: 'removeElement'; elementId: string };
