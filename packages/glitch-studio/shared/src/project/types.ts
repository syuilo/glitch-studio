import type { CustomNodeGraphEffect } from '@gs/subsystems_custom-node-graph-effect_shared/types.ts';
import type { CustomShaderEffectDefinition } from '@gs/subsystems_effect_shared/custom-shader-effect-definition.ts';

// 登録時の識別子・表示名はプロジェクトが所有し、Custom Node Graph Effectの定義には含めない。
export type ProjectCustomNodeGraphEffect = CustomNodeGraphEffect & {
	id: string;
	name: string;
};

export type ProjectCustomShaderEffect = CustomShaderEffectDefinition & {
	id: string;
	name: string;
	summary: string;
};
