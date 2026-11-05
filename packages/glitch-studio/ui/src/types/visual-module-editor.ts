import type { EffectResolution } from '@gs/subsystems_effect_shared/resolution.ts';
import type { NodeOutputReference, VisualModulePublicParameterId, VisualModuleOutputDef, VisualModuleParamDef } from '@gs/subsystems_visual-module_shared/types.ts';
import type { ParamEdit } from '@/components/GsVisualParam.vue';
import type { VisualModuleCustomParameterDefinition, VisualModuleCustomParameterId } from '@gs/subsystems_visual-module_shared/types.ts';
import type { VisualModuleValueParameterEdit } from './parameter-edit.ts';

export type VisualModuleAssetDropActions = {
	dropFiles: (files: readonly File[]) => Promise<boolean>;
	dropAsset: (assetId: string) => Promise<boolean>;
};

// 編集操作だけを通知し、保存先の特定とUndo/Redo用コマンドへの変換は親が行う。
export type VisualModuleEdit =
	| { kind: 'customParameterClipboard'; parameterId: VisualModuleCustomParameterId; operation: 'copy' | 'paste' }
	| { kind: 'updateCustomParameter'; definition: VisualModuleCustomParameterDefinition; mergeKey?: string | null }
	| { kind: 'removeCustomParameter'; parameterId: VisualModuleCustomParameterId }
	| { kind: 'editCustomParameter'; parameterId: VisualModuleCustomParameterId; edit: VisualModuleValueParameterEdit; mergeKey?: string | null }
	| { kind: 'removeNode'; nodeId: string }
	| { kind: 'setNodeBypass'; nodeId: string; bypass: boolean }
	| { kind: 'setNodeResolution'; nodeId: string; resolution: EffectResolution }
	| { kind: 'setNodeDisplayName'; nodeId: string; displayName: string }
	| { kind: 'editNodeStaticSetting'; nodeId: string; key: string; value: string | number | boolean | null }
	| { kind: 'editNodeParam'; nodeId: string; edit: ParamEdit }
	| { kind: 'reorderNodes'; nodeIds: string[] }
	| { kind: 'setOutputConnection'; nodeId: string; outputId: string; value: NodeOutputReference | null }
	| { kind: 'addParamDef'; def: VisualModuleParamDef }
	| { kind: 'updateParamDef'; defId: VisualModulePublicParameterId; changes: Partial<Omit<VisualModuleParamDef, 'id'>>; mergeKey?: string | null }
	| { kind: 'removeParamDef'; defId: VisualModulePublicParameterId }
	| { kind: 'addOutputDef'; def: VisualModuleOutputDef }
	| { kind: 'updateOutputDef'; defId: string; changes: Partial<Omit<VisualModuleOutputDef, 'id'>> }
	| { kind: 'removeOutputDef'; defId: string }
	| { kind: 'setPrimaryOutput'; outputId: string | null }
	| { kind: 'setPrimaryAudioInput'; inputId: VisualModulePublicParameterId | null }
	| { kind: 'setPrimaryInput'; inputId: VisualModulePublicParameterId | null };
