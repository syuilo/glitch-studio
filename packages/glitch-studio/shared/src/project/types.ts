import type { VisualModule } from '@gs/subsystems_visual-module_shared/types.ts';
import type { CustomShaderEffectDefinition } from '@gs/subsystems_effect_shared/custom-shader-effect-definition.ts';

// 登録時の識別子・表示名はプロジェクトが所有し、モジュールの定義には含めない。
export type ProjectVisualModule = VisualModule & {
	id: string;
	name: string;
};

export type ProjectCustomShaderEffect = CustomShaderEffectDefinition & {
	id: string;
	name: string;
	description: string;
};
