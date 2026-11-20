import type { CustomNodeGraphEffect } from '@gs/subsystems_effect_shared/custom-node-graph-effect.ts';
import type { CustomShaderEffect } from '@gs/subsystems_effect_shared/custom-shader-effect.ts';

/** キーは各Custom Node Graph Effect内のノードID。インラインの子も配置先で編集情報を所有する。 */
export type CustomNodeGraphEffectEditorMetadata = {
	nodeMetadata?: Record<string, {
		displayName?: string;
		position?: { x: number; y: number };
		inlineCustomNodeGraphEffect?: CustomNodeGraphEffectEditorMetadata;
	}>;
};

/** 登録情報はプロジェクトが所有する。配線・実行にはdefinitionだけを渡す。 */
export type ProjectCustomNodeGraphEffect = CustomNodeGraphEffectEditorMetadata & {
	id: string;
	name: string;
	definition: CustomNodeGraphEffect;
};

export type ProjectCustomShaderEffect = {
	id: string;
	name: string;
	summary: string;
	definition: CustomShaderEffect;
};

export type ProjectEffectRegistrations = {
	customShaderEffects: ProjectCustomShaderEffect[];
	customNodeGraphEffects: ProjectCustomNodeGraphEffect[];
};
