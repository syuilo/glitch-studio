import type { NodeOutputReference, VisualModuleCustomParameterId, VisualModuleOutputDef, VisualModuleParamDef } from '@glitch/shared/visual-module/types.ts';
import type { ParamEdit } from '@/components/GsVisualParam.vue';

// 編集操作だけを通知し、保存先の特定とUndo/Redo用コマンドへの変換は親が行う。
export type VisualModuleEdit =
	| { kind: 'removeNode'; nodeId: string }
	| { kind: 'setNodeBypass'; nodeId: string; bypass: boolean }
	| { kind: 'editNodeParam'; nodeId: string; edit: ParamEdit }
	| { kind: 'reorderNodes'; nodeIds: string[] }
	| { kind: 'setOutputConnection'; nodeId: string; outputId: string; value: NodeOutputReference | null }
	| { kind: 'addParamDef'; def: VisualModuleParamDef }
	| { kind: 'updateParamDef'; defId: VisualModuleCustomParameterId; changes: Partial<Omit<VisualModuleParamDef, 'id'>> }
	| { kind: 'removeParamDef'; defId: VisualModuleCustomParameterId }
	| { kind: 'addOutputDef'; def: VisualModuleOutputDef }
	| { kind: 'updateOutputDef'; defId: string; changes: Partial<Omit<VisualModuleOutputDef, 'id'>> }
	| { kind: 'removeOutputDef'; defId: string }
	| { kind: 'setPrimaryOutput'; outputId: string | null };
