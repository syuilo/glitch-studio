import type { EffectResolution } from '@gs/subsystems_effect_shared/resolution.ts';
import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { NodeOutputReference, CustomNodeGraphEffectOutputDef, CustomNodeGraphEffectParamDef } from '@/types/custom-node-graph-effect-view.ts';
import type { ParamEdit } from '@/components/GsVisualParam.vue';
import type { CustomNodeGraphEffectCustomParameterDefinition } from '@/types/custom-node-graph-effect-view.ts';
import type { CustomNodeGraphEffectValueParameterEdit } from './parameter-edit.ts';

export type CustomNodeGraphEffectAssetDropActions = {
	projectSessionId: string;
	dropFiles: (files: readonly File[]) => Promise<boolean>;
	dropAsset: (assetId: string) => Promise<boolean>;
};

// 編集操作だけを通知し、保存先の特定とUndo/Redo用コマンドへの変換は親が行う。
export type CustomNodeGraphEffectEdit =
	| { kind: 'customParameterClipboard'; parameterId: string; operation: 'copy' | 'paste' }
	| { kind: 'updateCustomParameter'; definition: CustomNodeGraphEffectCustomParameterDefinition; mergeKey?: string | null }
	| { kind: 'removeCustomParameter'; parameterId: string }
	| { kind: 'editCustomParameter'; parameterId: string; edit: CustomNodeGraphEffectValueParameterEdit; mergeKey?: string | null }
	| { kind: 'addRelayNode' }
	| { kind: 'setRelayInput'; nodeId: string; value: NodeOutputReference | null }
	| { kind: 'setRelayDataType'; nodeId: string; dataType: TextureDataType }
	| { kind: 'removeNode'; nodeId: string }
	| { kind: 'setNodeBypass'; nodeId: string; bypass: boolean }
	| { kind: 'setNodeResolution'; nodeId: string; resolution: EffectResolution }
	| { kind: 'resetNodeParameters'; nodeId: string }
	| { kind: 'setNodeDisplayName'; nodeId: string; displayName: string }
	| { kind: 'editNodeStaticSetting'; nodeId: string; key: string; value: string | number | boolean | null }
	| { kind: 'editNodeParam'; nodeId: string; edit: ParamEdit }
	| { kind: 'reorderNodes'; nodeIds: string[] }
	| { kind: 'setOutputConnection'; nodeId: string; outputId: string; value: NodeOutputReference | null }
	| { kind: 'addParamDef'; def: CustomNodeGraphEffectParamDef }
	| { kind: 'updateParamDef'; defId: string; changes: Partial<Omit<CustomNodeGraphEffectParamDef, 'id'>>; mergeKey?: string | null }
	| { kind: 'removeParamDef'; defId: string }
	| { kind: 'addOutputDef'; def: CustomNodeGraphEffectOutputDef }
	| { kind: 'updateOutputDef'; defId: string; changes: Partial<Omit<CustomNodeGraphEffectOutputDef, 'id'>> }
	| { kind: 'removeOutputDef'; defId: string }
	| { kind: 'setPrimaryOutput'; outputId: string | null }
	| { kind: 'setPrimaryAudioInput'; inputId: string | null }
	| { kind: 'setPrimaryInput'; inputId: string | null };
