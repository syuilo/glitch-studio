import type { NodesEffect } from '@gs/subsystems_effect_shared/nodes-effect.ts';
import type { CustomShaderEffect } from '@gs/subsystems_effect_shared/custom-shader-effect.ts';

/** キーは各Nodes Effect内のノードID。インラインの子も配置先で編集情報を所有する。 */
export type NodesEffectEditorMetadata = {
	nodeMetadata?: Record<string, {
		displayName?: string;
		position?: { x: number; y: number };
		inlineNodesEffect?: NodesEffectEditorMetadata;
	}>;
};

/** 登録情報はプロジェクトが所有する。配線・実行にはdefinitionだけを渡す。 */
export type ProjectNodesEffect = NodesEffectEditorMetadata & {
	id: string;
	name: string;
	definition: NodesEffect;
};

export type ProjectCustomShaderEffect = {
	id: string;
	name: string;
	summary: string;
	definition: CustomShaderEffect;
};

export type ProjectEffectRegistrations = {
	customShaderEffects: ProjectCustomShaderEffect[];
	nodesEffects: ProjectNodesEffect[];
};
