import { createUntrimmedTimelineLayerTiming } from '@glitch/shared/timeline/timing.ts';
import { genId } from '@glitch/shared/utility/id.ts';
import { deepClone } from '@glitch/shared/utility/deep-clone.ts';
import { visualModuleCustomParameterId, visualModuleCustomParameterName } from '@glitch/shared/visual-module/types.ts';
import { timelineCompositingParamDefs } from '@glitch/shared/timeline/timeline-compositing.ts';
import type { TimelineInlineVisualModuleLayer } from '@glitch/shared/timeline/types.ts';

export function createInlineVisualModuleLayer(positionMs: number): TimelineInlineVisualModuleLayer {
	const inputId = visualModuleCustomParameterId(genId());
	const outputId = genId();
	return {
		id: genId(), layerType: 'inlineVisualModule', ...createUntrimmedTimelineLayerTiming(positionMs, 5000),
		paramValues: {}, automationGraphs: [],
		compositingParamValues: deepClone({
			blendMode: timelineCompositingParamDefs.blendMode.defaultValue,
			opacity: timelineCompositingParamDefs.opacity.defaultValue,
			translation: timelineCompositingParamDefs.translation.defaultValue,
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
