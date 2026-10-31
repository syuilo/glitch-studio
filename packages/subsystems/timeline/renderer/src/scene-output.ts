import { TIMELINE_FRAME } from '@gs/subsystems_timeline_shared/spatial.ts';
import { createTimelineCompositor } from './timeline-compositor.ts';
import { timelineImageBounds } from './timeline-image.ts';
import type { IntermediateTextureFormat } from '@gs/shared/types.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { TimelineImage } from './timeline-image.ts';
import type { TimelineCompositingSettings } from './timeline-compositing-parameters.ts';

const settings: TimelineCompositingSettings = {
	transformTarget: 'image',
	position: [0, 0],
	origin: [0, 0],
	scale: [1, 1],
	rotation: 0,
	fitMode: 'stretch',
	opacity: 1,
	blendMode: 19,
	mask: null,
	layerMask: null,
	coordinateSpace: 'screen',
	depth: 0,
	clipToFrame: false,
};
/** Scene出力・有限のエフェクト入力として画面を確定する。グループ境界では自動適用しない。 */
export function createSceneOutput(options: { device: GPUDevice; vertex: GPUShaderModule; resolution: Resolution; format: IntermediateTextureFormat }) {
	let compositor: ReturnType<typeof createTimelineCompositor> | null = null;
	const isSceneTexture = (output: TimelineImage): boolean => {
		if (output.kind !== 'texture' || output.texture.width !== options.resolution.width || output.texture.height !== options.resolution.height) return false;
		const bounds = timelineImageBounds(output);
		return bounds.left === -1 && bounds.bottom === -1 && bounds.right === 1 && bounds.top === 1;
	};
	return {
		/** 入力の正規化が必要な場合だけGPUへ送信し、定数・確定済みのScene画像はそのまま借用する。 */
		renderInput(output: TimelineImage): TimelineImage {
			if (output.kind === 'uniform' || isSceneTexture(output)) return output;
			// 同じ縦横比でも物理寸法を揃え、素材差し替えや入力の有無で宣言寸法とずれないようにする。
			// ノードはTimelineのregionを知らないため、画面外領域・Stretchもここで画素へ確定する。
			const encoder = options.device.createCommandEncoder();
			const texture = this.render(encoder, output);
			options.device.queue.submit([encoder.finish()]);
			return { kind: 'texture', texture };
		},
		render(encoder: GPUCommandEncoder, output: TimelineImage): GPUTexture {
			if (output.kind === 'texture' && isSceneTexture(output)) return output.texture;
			compositor ??= createTimelineCompositor(options);
			// spaceの既定値を適用し、後続のprojectedとfixedBoundsだけを指定するためundefinedで省略する。
			const result = compositor.render(encoder, { kind: 'uniform', value: [0, 0, 0, 0] }, output, settings, undefined, true, TIMELINE_FRAME);
			if (result.kind !== 'texture') throw new Error('Expected scene texture');
			return result.texture;
		},
		dispose() { compositor?.dispose(); },
	};
}
