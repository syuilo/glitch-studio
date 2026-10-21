import type { AutomationGraphData, AutomationGraphPlaybackOptions } from '../automation-graph/automation-graph.ts';
import type { ExpressionVariableName } from '../expression/expression-environment.ts';
import type { KeyframesTimelineData, KeyframesTimelinePlaybackOptions } from '../keyframes/keyframes-timeline.ts';

// CPUで値を評価できる入力方式。ノードやレイヤーの画像参照は各ドメインで解決する。
export type ParameterExpressionModifier = {
	enabled: boolean;
	code: string;
};

export type ValueParameterSource = {
	inputSource: 'literal';
	value: any;
} | {
	inputSource: 'envVariable';
	variable: ExpressionVariableName;
} | {
	inputSource: 'expression';
	expression: string;
} | ({
	inputSource: 'automationGraphReference';
	automationGraphId: string | null;
} & AutomationGraphPlaybackOptions) | ({
	inputSource: 'automationGraphInline';
	automationGraph: AutomationGraphData;
} & AutomationGraphPlaybackOptions) | ({
	inputSource: 'keyframesTimelineInline';
	keyframesTimeline: KeyframesTimelineData;
} & KeyframesTimelinePlaybackOptions);

// 未指定とnullは加工なし。未編集のBindingには不要な設定を追加しない。
// コンテナ・音声入力・各ドメイン固有の接続は加工対象に含めない。
export type ValueParameterBinding = ValueParameterSource & {
	expressionModifier?: ParameterExpressionModifier | null;
};
