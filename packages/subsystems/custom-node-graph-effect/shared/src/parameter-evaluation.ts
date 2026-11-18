import type { CustomNodeGraphEffectPublicParameterId } from './types.ts';

// 呼び出し側で評価した公開パラメータのCPU値。GPU入力は別の契約で渡す。
export type CustomNodeGraphEffectEvaluatedParameterValues = ReadonlyMap<CustomNodeGraphEffectPublicParameterId, any>;
