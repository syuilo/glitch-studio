import { TIMELINE_FRAME } from '@gs/subsystems_timeline_shared/spatial.ts';
import { createTimelineCompositor } from './timeline-compositor.ts';
import { timelineImageBounds } from './timeline-image.ts';
import type { IntermediateTextureFormat } from '@gs/shared/types.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { TimelineImage } from './timeline-image.ts';
import type { TimelineCompositingSettings } from './timeline-compositing-parameters.ts';

const settings: TimelineCompositingSettings = { position: [0, 0], origin: [0, 0], scale: [1, 1], rotation: 0, fitMode: 'stretch', opacity: 1, blendMode: 19, coordinateSpace: 'screen', depth: 0, clipToFrame: false };
/** Scene出力・有限のエフェクト入力として画面を確定する。グループ境界では自動適用しない。 */
export function createSceneOutput(options: { device: GPUDevice; vertex: GPUShaderModule; resolution: Resolution; format: IntermediateTextureFormat }) {
	let compositor: ReturnType<typeof createTimelineCompositor> | null = null;
	return {
		/** ノード入力の画面が既に確定していれば、定数や素材の解像度をそのまま借用する。 */
		renderInput(encoder: GPUCommandEncoder, output: TimelineImage): TimelineImage {
			const bounds = timelineImageBounds(output);
			// ノードはTimelineのregionを解釈しない。Stretchで借用した素材など、
			// 物理寸法の比率がSceneと異なる入力はここで画素へ確定してから渡す。
			const sameAspectRatio = output.kind !== 'texture'
				|| output.texture.width * options.resolution.height === output.texture.height * options.resolution.width;
			return sameAspectRatio && bounds.left === -1 && bounds.bottom === -1 && bounds.right === 1 && bounds.top === 1
				? output : { kind: 'texture', texture: this.render(encoder, output) };
		},
		render(encoder: GPUCommandEncoder, output: TimelineImage): GPUTexture {
			const bounds = timelineImageBounds(output);
			if (output.kind === 'texture' && output.texture.width === options.resolution.width && output.texture.height === options.resolution.height
				&& bounds.left === -1 && bounds.bottom === -1 && bounds.right === 1 && bounds.top === 1) return output.texture;
			compositor ??= createTimelineCompositor(options);
			// spaceの既定値を適用し、後続のprojectedとfixedBoundsだけを指定するためundefinedで省略する。
			const result = compositor.render(encoder, { kind: 'uniform', value: [0, 0, 0, 0] }, output, settings, undefined, true, TIMELINE_FRAME);
			if (result.kind !== 'texture') throw new Error('Expected scene texture');
			return result.texture;
		},
		dispose() { compositor?.dispose(); },
	};
}
