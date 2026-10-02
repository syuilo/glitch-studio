import type { AutomationGraphData, AutomationGraphPlaybackOptions } from '../automation-graph/automation-graph.ts';
import type { ExpressionVariableName } from '../expression/expression-environment.ts';
import type { KeyframesTimelineData, KeyframesTimelinePlaybackOptions } from '../keyframes/keyframes-timeline.ts';

// CPUで値を評価できる入力方式。ノードやレイヤーの画像参照は各ドメインで解決する。
export type ValueParameterBinding = {
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
