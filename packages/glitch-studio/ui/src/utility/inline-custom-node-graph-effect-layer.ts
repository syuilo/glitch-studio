import { createTimelineClipTiming } from '@gs/subsystems_timeline_shared/timing.ts';
import { genId } from '@gs/shared/utility/id.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { customNodeGraphEffectPublicParameterId, customNodeGraphEffectPublicParameterName } from '@gs/subsystems_custom-node-graph-effect_shared/types.ts';
import { timelineCompositingParamDefs } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import type { TimelineInlineCustomNodeGraphEffectLayer } from '@gs/subsystems_timeline_shared/types.ts';

export function createInlineCustomNodeGraphEffectLayer(startMs: number): TimelineInlineCustomNodeGraphEffectLayer {
	const inputId = customNodeGraphEffectPublicParameterId(genId());
	const outputId = genId();
	return {
		id: genId(),
		name: 'Custom Node Graph Effect',
		layerType: 'inlineCustomNodeGraphEffect',
		transformTarget: 'image',
		isDisabled: false,
		isSolo: false,
		color: null,
		clips: [{ id: genId(), ...createTimelineClipTiming(startMs, 5000) }],
		customNodeGraphEffectParamValues: {},
		automationGraphs: [],
		forceDisableMotionBlur: false,
		mask: null,
		layerMask: null,
		isIncludedInComposite: true,
		coordinateSpace: 'screen',
		compositingParamValues: deepClone({
			depth: timelineCompositingParamDefs.depth.defaultValue,
			clipToFrame: timelineCompositingParamDefs.clipToFrame.defaultValue,
			fitMode: timelineCompositingParamDefs.fitMode.defaultValue,
			blendMode: timelineCompositingParamDefs.blendMode.defaultValue,
			opacity: timelineCompositingParamDefs.opacity.defaultValue,
			position: timelineCompositingParamDefs.position.defaultValue,
			origin: timelineCompositingParamDefs.origin.defaultValue,
			scale: timelineCompositingParamDefs.scale.defaultValue,
			rotation: timelineCompositingParamDefs.rotation.defaultValue,
		}),
		customNodeGraphEffect: {
			customParameterDefs: [],
			customParameterValues: {},
			paramDefs: [{
				id: inputId,
				nameForReference: customNodeGraphEffectPublicParameterName('input'),
				dataType: { kind: 'color' },
				ui: { label: 'Input', control: {} },
				defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
				canNode: true,
			}],
			outputDefs: [{
				id: outputId,
				label: 'Output',
				name: 'output',
				dataType: { kind: 'color' },
			}],
			primaryOutputId: outputId,
			primaryInputId: inputId,
			automationGraphs: [],
			// 通常合成で背景を二重に重ねないよう、新規レイヤーは未接続から始める。
			// エフェクト追加時の既存コマンドが、その主出力をOutへ接続する。
			nodes: [{ id: genId(), type: 'globalIn' }, { id: genId(), type: 'globalOut', inputs: {} }],
		},
	};
}
