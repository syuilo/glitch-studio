import type { timelineCompositingParamDefs } from './timeline-compositing.ts';
import type { TimelineClip, TimelineAssetClip, TimelineVideoClip, TimelineSceneClip } from './clip.ts';
import type { TimelineSceneResolution } from './scene-resolution.ts';
import type { EffectResolution } from '@gs/subsystems_effect_shared/resolution.js';
import type { ParameterChangeKind } from '@gs/shared/parameter/parameter-definition.ts';
import type { AutomationGraph } from '@gs/shared/automation-graph/automation-graph.ts';
import type { TimelineParameterBinding, TimelineEffectParameterBinding, TimelineVisualModuleParameterBinding } from './parameter-binding.ts';
import type { VisualModule } from '@gs/subsystems_visual-module_shared/types.js';
import type { Shape } from './shape.ts';

export type TimelineParameterTarget = 'module' | 'effect' | 'shape' | 'compositing' | 'audio';

// definitionはレイヤー全体の追加・削除・置換。部分編集では変更した内容を列挙し、
// 実行インスタンスの扱いは利用側へ委ねる。
export type TimelineLayerChange =
	| { type: 'parameter'; target: TimelineParameterTarget; kind: ParameterChangeKind }
	| { type: 'definition' | 'clips' | 'resolution' | 'disabled' };

type TimelineLayerBase<Clip extends TimelineClip> = {
	id: string;
	name: string;
	clips: Clip[];
	automationGraphs: AutomationGraph[];
	/** 無効時は映像・音声とも評価せず、クリップの配置やSceneの長さは維持する。 */
	isDisabled: boolean;
};

type TimelineAudioLayerBase = {
	audioParamValues: { volume: TimelineParameterBinding };
};

type TimelineVisualLayerBase = {
	compositingParamValues: Record<keyof typeof timelineCompositingParamDefs, TimelineParameterBinding>;
};

export type { TimelineParameterBinding, TimelineEffectParameterBinding } from './parameter-binding.ts';

export type TimelineVisualModuleLayer = TimelineLayerBase<TimelineClip> & TimelineVisualLayerBase & {
	layerType: 'visualModule';
	visualModuleId: string;
	visualModuleParamValues: Record<string, TimelineVisualModuleParameterBinding>;
};

export type TimelineInlineVisualModuleLayer = TimelineLayerBase<TimelineClip> & TimelineVisualLayerBase & {
	layerType: 'inlineVisualModule';
	visualModule: VisualModule;
	visualModuleParamValues: Record<string, TimelineVisualModuleParameterBinding>;
};

export type TimelineEffectLayer = TimelineLayerBase<TimelineClip> & TimelineVisualLayerBase & {
	layerType: 'effect';
	effectId: string;
	effectParamValues: Record<string, TimelineEffectParameterBinding>;
	resolution: EffectResolution;
};

/** シェイプはレイヤー所有。クリップは表示区間だけを持ち、形状のキーはScene時刻で評価する。 */
export type TimelineShapeLayer = TimelineLayerBase<TimelineClip> & TimelineVisualLayerBase & {
	layerType: 'shape';
	shape: Shape;
};

export type TimelineAudioLayer = TimelineLayerBase<TimelineAssetClip> & TimelineAudioLayerBase & {
	layerType: 'audio';
};

/** 静止画像は素材長を持たず、内容時刻は描画に影響しない。 */
export type TimelineImageLayer = TimelineLayerBase<TimelineAssetClip> & TimelineVisualLayerBase & {
	layerType: 'image';
};

/** 映像と音声は同じ素材時刻・トリムを共有する。Playerの再生状態には依存しない。 */
export type TimelineVideoLayer = TimelineLayerBase<TimelineVideoClip> & TimelineAudioLayerBase & TimelineVisualLayerBase & {
	layerType: 'video';
};

/** 参照先は透明背景から描画する。配置期間は参照先の長さが変わっても自動伸縮しない。 */
export type TimelineSceneLayer = TimelineLayerBase<TimelineSceneClip> & TimelineAudioLayerBase & TimelineVisualLayerBase & {
	layerType: 'scene';
};

export type TimelineLayer = TimelineVisualModuleLayer | TimelineInlineVisualModuleLayer | TimelineEffectLayer | TimelineShapeLayer | TimelineAudioLayer | TimelineImageLayer | TimelineVideoLayer | TimelineSceneLayer;

/** 長さは直下の全クリップの終了時刻の最大値から求め、空の場合は0とする。 */
export type TimelineScene = {
	id: string;
	name: string;
	resolution: TimelineSceneResolution;

	/** UIの上から下への表示順。先頭が最上層で、描画・合成は末尾から先頭へ行う。 */
	layers: TimelineLayer[];
};
