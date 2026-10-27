import type { timelineCompositingParamDefs, TimelineLayerCoordinateSpace, TimelineLayerTransformTarget, TimelineMask, TimelineLayerMask } from './timeline-compositing.ts';
import type { TimelineCameraParameterValues } from './layers/camera/camera.ts';
import type { TimelineTransformParameterValues } from './layers/transform/transform.ts';
import type { TimelineClip, TimelineContentClip, TimelineMediaClip, TimelineAssetClip, TimelineVideoClip, TimelineSceneClip } from './clip.ts';
import type { TimelineSceneResolution } from './scene-resolution.ts';
import type { EffectResolution } from '@gs/subsystems_effect_shared/resolution.js';
import type { ParameterChangeKind } from '@gs/shared/parameter/parameter-definition.ts';
import type { AutomationGraph } from '@gs/shared/automation-graph/automation-graph.ts';
import type { TimelineParameterBinding, TimelineEffectParameterBinding, TimelineVisualModuleParameterBinding } from './parameter-binding.ts';
import type { VisualModule } from '@gs/subsystems_visual-module_shared/types.js';
import type { VoicevoxSubtitleParameterValues } from './layers/voicevox/voicevox-subtitle.ts';
import type { TextParameterValues } from './layers/text/text.ts';
import type { Shape } from './layers/shape/shape.ts';
import type { TimelineLayerCustomParameterDefinition } from './custom-parameters.ts';
import type { VoicevoxSettings, VoicevoxUtterance } from './layers/voicevox/voicevox.ts';

export type TimelineParameterTarget = 'customParameter' | 'module' | 'effect' | 'shape' | 'text' | 'voicevoxSubtitle' | 'camera' | 'transform' | 'compositing' | 'audio';

// definitionはレイヤー全体の追加・削除・置換。部分編集では変更した内容を列挙し、
// 実行インスタンスの扱いは利用側へ委ねる。
export type TimelineLayerChange =
	| { type: 'parameter'; target: TimelineParameterTarget; kind: ParameterChangeKind }
	| { type: 'definition' | 'clips' | 'resolution' | 'disabled' | 'motionBlur' | 'coordinateSpace' | 'mask' | 'layerMask' | 'compositeInclusion' | 'transformTarget' };

type TimelineLayerCommon = {
	id: string;
	name: string;
	/** UI上の識別用RGBA（各成分0〜1）。nullはレイヤー種別のデフォルト色を使う。 */
	color: [number, number, number, number] | null;
	/** 無効時は映像・音声とも評価せず、クリップの配置やSceneの長さは維持する。 */
	isDisabled: boolean;
};

type TimelineLayerParameters = {
	automationGraphs: AutomationGraph[];
	customParameterDefs?: TimelineLayerCustomParameterDefinition[];
	customParameterValues?: Record<string, TimelineParameterBinding>;
};

type TimelineLayerBase<Clip extends TimelineClip> = TimelineLayerCommon & TimelineLayerParameters & { clips: Clip[] };

type TimelineAudioLayerBase = {
	audioParamValues: { volume: TimelineParameterBinding };
};

type TimelineVisualLayerBase = {
	coordinateSpace: TimelineLayerCoordinateSpace;
	mask: TimelineMask | null;
	layerMask: TimelineLayerMask | null;
	/** 通常合成だけから除外する。参照用の単独描画・音声は引き続き評価できる。 */
	isIncludedInComposite: boolean;
	/** 内容・合成設定をフレームの基準時刻で評価する。グループ・Sceneでは配下にも適用する。 */
	forceDisableMotionBlur: boolean;
	compositingParamValues: Record<keyof typeof timelineCompositingParamDefs, TimelineParameterBinding>;
};

export type { TimelineParameterBinding, TimelineEffectParameterBinding } from './parameter-binding.ts';

export type TimelineVisualModuleLayer = TimelineLayerBase<TimelineContentClip> & TimelineVisualLayerBase & {
	layerType: 'visualModule';
	/** 未指定は画像を変形する。入力接続とは独立した静的な設定。 */
	transformTarget?: TimelineLayerTransformTarget;
	visualModuleId: string;
	visualModuleParamValues: Record<string, TimelineVisualModuleParameterBinding>;
};

export type TimelineInlineVisualModuleLayer = TimelineLayerBase<TimelineContentClip> & TimelineVisualLayerBase & {
	layerType: 'inlineVisualModule';
	transformTarget?: TimelineLayerTransformTarget;
	visualModule: VisualModule;
	visualModuleParamValues: Record<string, TimelineVisualModuleParameterBinding>;
};

export type TimelineEffectLayer = TimelineLayerBase<TimelineContentClip> & TimelineVisualLayerBase & {
	layerType: 'effect';
	transformTarget?: TimelineLayerTransformTarget;
	effectId: string;
	effectParamValues: Record<string, TimelineEffectParameterBinding>;
	resolution: EffectResolution;
};

/** シェイプはレイヤー所有。クリップは表示区間だけを持ち、形状のキーはScene時刻で評価する。 */
export type TimelineShapeLayer = TimelineLayerBase<TimelineContentClip> & TimelineVisualLayerBase & {
	layerType: 'shape';
	shape: Shape<TimelineParameterBinding>;
};

/** 本文と装飾はレイヤー所有。クリップは表示区間だけを持つ。 */
export type TimelineTextLayer = TimelineLayerBase<TimelineContentClip> & TimelineVisualLayerBase & {
	layerType: 'text';
	textParamValues: TextParameterValues<TimelineParameterBinding>;
};

export type TimelineAudioLayer = TimelineLayerBase<TimelineMediaClip> & TimelineAudioLayerBase & {
	layerType: 'audio';
};

/** Scene直下またはTransform配下で視点を制御する。キーはScene時刻で評価する。 */
export type TimelineCameraLayer = TimelineLayerBase<TimelineContentClip> & {
	layerType: 'camera';
	cameraParamValues: TimelineCameraParameterValues;
	forceDisableMotionBlur: boolean;
};

/** 発話はScene時刻に固定し、クリップは発話と字幕の有効区間だけを所有する。 */
export type TimelineVoicevoxLayer = TimelineLayerBase<TimelineContentClip> & TimelineAudioLayerBase & TimelineVisualLayerBase & {
	layerType: 'voicevox';
	voicevox: VoicevoxSettings;
	utterances: VoicevoxUtterance[];
	subtitleParamValues: VoicevoxSubtitleParameterValues<TimelineParameterBinding>;
};

/** 静止画像は素材長を持たず、内容時刻は描画に影響しない。 */
export type TimelineImageLayer = TimelineLayerBase<TimelineAssetClip> & TimelineVisualLayerBase & {
	layerType: 'image';
};

/** 通常再生は映像・音声を個別に有効化し、同じ時計を使う。固定表示は映像だけを出力する。 */
export type TimelineVideoLayer = TimelineLayerBase<TimelineVideoClip> & TimelineAudioLayerBase & TimelineVisualLayerBase & {
	layerType: 'video';
};

/** 参照先は透明背景から描画する。配置期間は参照先の長さが変わっても自動伸縮しない。 */
export type TimelineSceneLayer = TimelineLayerBase<TimelineSceneClip> & TimelineAudioLayerBase & TimelineVisualLayerBase & {
	layerType: 'scene';
};

/** 子は同じSceneの時刻・画面を使う。グループ自身は配置クリップを持たない。 */
export type TimelineGroupLayer = TimelineLayerCommon & TimelineLayerParameters & TimelineAudioLayerBase & TimelineVisualLayerBase & {
	layerType: 'group';
	/** 未指定は平面化。空間の奥行きを保つ場合だけ明示する。 */
	compositingMode?: 'flat' | 'preserveDepth';
	layers: TimelineLayer[];
};

export type TimelineClipLayer = TimelineVisualModuleLayer | TimelineInlineVisualModuleLayer | TimelineEffectLayer | TimelineShapeLayer | TimelineTextLayer | TimelineAudioLayer | TimelineImageLayer | TimelineVideoLayer | TimelineSceneLayer | TimelineVoicevoxLayer | TimelineCameraLayer;
/** 子を平面化せず、座標系の移動だけを継承する。自身の画像・クリップ・音量は持たない。 */
export type TimelineTransformLayer = TimelineLayerCommon & TimelineLayerParameters & {
	layerType: 'transform';
	transformParamValues: TimelineTransformParameterValues;
	forceDisableMotionBlur: boolean;
	layers: TimelineLayer[];
};

/** 整理と一括無効化だけを担当し、描画・パラメータのスコープを作らない。 */
export type TimelineFolderLayer = TimelineLayerCommon & {
	layerType: 'folder';
	layers: TimelineLayer[];
};

/** 描画の境界を作らず、子孫へ公開する値とその評価設定だけを所有する。 */
export type TimelineParameterContainerLayer = TimelineLayerCommon & TimelineLayerParameters & {
	layerType: 'parameterContainer';
	layers: TimelineLayer[];
};

export type TimelineContainerLayer = TimelineGroupLayer | TimelineTransformLayer | TimelineFolderLayer | TimelineParameterContainerLayer;
export type TimelineNonCompositingContainerLayer = Exclude<TimelineContainerLayer, TimelineGroupLayer>;
export type TimelineLayer = TimelineClipLayer | TimelineContainerLayer;
export type TimelineLayerWithParameters = Exclude<TimelineLayer, TimelineFolderLayer>;

export function hasTimelineLayerParameters<Layer extends TimelineLayer>(layer: Layer): layer is Exclude<Layer, TimelineFolderLayer> {
	return layer.layerType !== 'folder';
}

export function isTimelineEffectOrVisualModuleLayer(layer: TimelineLayer): layer is TimelineEffectLayer | TimelineVisualModuleLayer | TimelineInlineVisualModuleLayer {
	return layer.layerType === 'effect' || layer.layerType === 'visualModule' || layer.layerType === 'inlineVisualModule';
}

export function getTimelineLayerTransformTarget(layer: TimelineLayer): TimelineLayerTransformTarget {
	return isTimelineEffectOrVisualModuleLayer(layer) ? layer.transformTarget ?? 'image' : 'image';
}

// 通信上はlayersを省くため、種別だけで分類し、絞り込み後も呼び出し元の型を保つ。
// layerTypeだけを渡された場合に、子レイヤーの存在まで保証してはならない。
export function isTimelineContainerLayer<Layer extends Pick<TimelineLayer, 'layerType'>>(layer: Layer): layer is Layer & Pick<TimelineContainerLayer, 'layerType'> {
	return layer.layerType === 'group' || layer.layerType === 'transform' || layer.layerType === 'folder' || layer.layerType === 'parameterContainer';
}

export function isTimelineNonCompositingContainerLayer(layer: TimelineLayer): layer is TimelineNonCompositingContainerLayer {
	return isTimelineContainerLayer(layer) && layer.layerType !== 'group';
}

export type TimelineVisualLayer = Exclude<TimelineLayer, TimelineAudioLayer | TimelineCameraLayer | TimelineNonCompositingContainerLayer>;

/** 映像合成・プレビュー変形の対象。カメラはSceneの視点を制御する別の役割を持つ。 */
export function isTimelineVisualLayer(layer: TimelineLayer): layer is TimelineVisualLayer {
	return layer.layerType !== 'audio' && layer.layerType !== 'camera' && !isTimelineNonCompositingContainerLayer(layer);
}

/** 描画走査には、画像を持たないTransformも含めて子へ入力と座標系を渡す。 */
export function isTimelineRenderLayer(layer: TimelineLayer): layer is TimelineVisualLayer | TimelineTransformLayer {
	return layer.layerType === 'transform' || isTimelineVisualLayer(layer);
}

/** 長さはグループ内部も含む全配置クリップの終端から求める。参照先Sceneの内部は含めない。 */
export type TimelineScene = {
	id: string;
	name: string;
	resolution: TimelineSceneResolution;

	/** UIの上から下への表示順。先頭が最上層で、描画・合成は末尾から先頭へ行う。 */
	layers: TimelineLayer[];
};
