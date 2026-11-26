import type { CurveAnimation } from '../curve-animation/curve-animation.ts';
import type { ExpressionVariableName } from '../expression/expression-environment.ts';
import type { KeyframesTimelineData, KeyframesTimelinePlaybackOptions } from '../keyframes/keyframes-timeline.ts';

// CPUで値を評価できる入力方式。ノードやレイヤーの画像参照は各ドメインで解決する。
export type ParameterExpressionModifier = {
	enabled: boolean;
	code: string;
};

type AtomicValueParameterSource = {
	inputSource: 'literal';
	value: any;
} | {
	inputSource: 'envVariable';
	variable: ExpressionVariableName;
} | {
	inputSource: 'expression';
	expression: string;
} | {
	inputSource: 'curveAnimationInline';
	curveAnimation: CurveAnimation;
} | ({
	inputSource: 'keyframesTimelineInline';
	keyframesTimeline: KeyframesTimelineData;
} & KeyframesTimelinePlaybackOptions);

export type ScalarParameterBinding = (
	| { inputSource: 'literal'; value: number }
	| Extract<AtomicValueParameterSource, { inputSource: 'expression' | 'curveAnimationInline' }>
	| ({ inputSource: 'keyframesTimelineInline'; keyframesTimeline: KeyframesTimelineData<{ kind: 'scalar' }> } & KeyframesTimelinePlaybackOptions)
) & { expressionModifier?: ParameterExpressionModifier | null };

export type VectorComponentsParameterSource = {
	inputSource: 'components';
	components: [first: ScalarParameterBinding, second: ScalarParameterBinding];
};

export type ValueParameterSource = AtomicValueParameterSource | VectorComponentsParameterSource;

// 未指定とnullは加工なし。未編集のBindingには不要な設定を追加しない。
// コンテナ・音声入力・各ドメイン固有の接続は加工対象に含めない。
export type ValueParameterBinding = ValueParameterSource & {
	expressionModifier?: ParameterExpressionModifier | null;
};
