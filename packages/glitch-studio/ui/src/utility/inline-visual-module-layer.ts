import { createTimelineClipTiming } from '@gs/subsystems_timeline_shared/timing.ts';
import { genId } from '@gs/shared/utility/id.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { visualModuleCustomParameterId, visualModuleCustomParameterName } from '@gs/subsystems_visual-module_shared/types.ts';
import { timelineCompositingParamDefs } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import type { TimelineInlineVisualModuleLayer } from '@gs/subsystems_timeline_shared/types.ts';

export function createInlineVisualModuleLayer(startMs: number): TimelineInlineVisualModuleLayer {
	const inputId = visualModuleCustomParameterId(genId());
	const outputId = genId();
	return {
		id: genId(), name: 'Visual Module', layerType: 'inlineVisualModule',
		isDisabled: false,
		clips: [{ id: genId(), ...createTimelineClipTiming(startMs, 5000) }],
		visualModuleParamValues: {}, automationGraphs: [],
		compositingParamValues: deepClone({
			fitMode: timelineCompositingParamDefs.fitMode.defaultValue,
			blendMode: timelineCompositingParamDefs.blendMode.defaultValue,
			opacity: timelineCompositingParamDefs.opacity.defaultValue,
			position: timelineCompositingParamDefs.position.defaultValue,
			origin: timelineCompositingParamDefs.origin.defaultValue,
			scale: timelineCompositingParamDefs.scale.defaultValue,
			rotation: timelineCompositingParamDefs.rotation.defaultValue,
		}),
		visualModule: {
			paramDefs: [{
				id: inputId, nameForReference: visualModuleCustomParameterName('input'),
				dataType: { kind: 'color' }, ui: { label: 'Input', control: {} },
				defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
				canNode: true,
			}],
			outputDefs: [{ id: outputId, label: 'Output', name: 'output', dataType: { kind: 'color' } }],
			primaryOutputId: outputId,
			primaryInputId: inputId,
			automationGraphs: [],
			// 通常合成で背景を二重に重ねないよう、新規レイヤーは未接続から始める。
			// エフェクト追加時の既存コマンドが、その主出力をOutへ接続する。
			nodes: [{ id: genId(), type: 'globalIn' }, { id: genId(), type: 'globalOut', inputs: {} }],
		},
	};
}
