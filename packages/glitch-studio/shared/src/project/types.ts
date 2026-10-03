import type { VisualModule } from '@gs/subsystems_visual-module_shared/types.ts';

// 登録時の識別子・表示名はプロジェクトが所有し、モジュールの定義には含めない。
export type ProjectVisualModule = VisualModule & {
	id: string;
	name: string;
};
