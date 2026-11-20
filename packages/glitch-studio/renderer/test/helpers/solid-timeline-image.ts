import type { Resolution } from '@gs/shared/resolution.ts';
import type { TimelineImage } from '@gs/subsystems_timeline_renderer/timeline-image.ts';

/** Timelineへ渡す一様色も指定寸法のtextureにする。画素は既に乗算済み。 */
export function createSolidTimelineImage(device: GPUDevice, resolution: Resolution, color: GPUColor): TimelineImage {
	const texture = device.createTexture({ size: resolution, format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
	const encoder = device.createCommandEncoder();
	encoder.beginRenderPass({ colorAttachments: [{ view: texture.createView(), loadOp: 'clear', storeOp: 'store', clearValue: color }] }).end();
	device.queue.submit([encoder.finish()]);
	return { kind: 'texture', texture };
}
