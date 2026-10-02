import type { VisualModuleCustomParameterId } from './types.ts';

// 呼び出し側で評価したカスタムパラメータのCPU値。GPU入力は別の契約で渡す。
export type VisualModuleEvaluatedParameterValues = ReadonlyMap<VisualModuleCustomParameterId, any>;
