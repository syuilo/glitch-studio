import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { AutomationGraphPlaybackOptions } from '@gs/shared/automation-graph/automation-graph.ts';
import type { ExpressionVariableName } from '@gs/shared/expression/expression-environment.ts';
import type { VisualModuleParameterBinding } from '@gs/subsystems_visual-module_shared/types.ts';
import type { TimelineEffectParameterBinding } from '@gs/subsystems_timeline_shared/parameter-binding.ts';

// 共用エディタだけが複数ドメインの方式を扱う。保存先の型は各ドメインのBindingを使う。
export type EditableParameterBinding = VisualModuleParameterBinding | TimelineEffectParameterBinding;

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
	| { kind: 'automationGraphReference'; value: string | null; options?: Partial<AutomationGraphPlaybackOptions> }
	| ParameterInputSourceEdit<ValueParameterBinding['inputSource']>
	| { kind: 'reset' }
	| { kind: 'addElement' }
	| { kind: 'removeElement'; elementId: string };
