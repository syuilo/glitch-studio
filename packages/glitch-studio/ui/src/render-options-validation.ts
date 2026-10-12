import type { Resolution } from '@gs/shared/resolution.ts';
import type { ValidationDiagnostic } from '@gs/shared/validation/diagnostic.ts';
import type { TimelineMotionBlurSettings } from '@gs/subsystems_timeline_shared/motion-blur.ts';

/** 明示設定は更新時に検査する。素材・auto出力の寸法検査はGPU実行境界に残す。 */
export function inspectRenderOptions(options: { resolution: Resolution; resolutionScale: number; outputResolution?: Resolution | null }, maxDimension: number, timeline?: { timelineFps: number; timelineMotionBlur: TimelineMotionBlurSettings }): ValidationDiagnostic[] {
	const diagnostics: ValidationDiagnostic[] = [];
	if (!Number.isFinite(options.resolutionScale) || options.resolutionScale <= 0) diagnostics.push({ code: 'resolution.scale', message: 'Resolution scale must be positive and finite' });
	for (const resolution of [options.resolution, options.outputResolution].filter((value): value is Resolution => value != null)) {
		if (![resolution.width, resolution.height].every(value => Number.isSafeInteger(value) && value > 0)) diagnostics.push({ code: 'resolution.size', message: 'Resolution width and height must be positive integers' });
	}
	if (options.resolution.width * options.resolutionScale > maxDimension || options.resolution.height * options.resolutionScale > maxDimension
		|| (options.outputResolution && (options.outputResolution.width > maxDimension || options.outputResolution.height > maxDimension))) diagnostics.push({ code: 'resolution.limit', message: `Output resolution exceeds ${maxDimension}` });
	if (timeline) {
		if (!Number.isFinite(timeline.timelineFps) || timeline.timelineFps < 1 || timeline.timelineFps > 120) diagnostics.push({ code: 'timeline.fps', message: 'Timeline frame rate must be between 1 and 120 fps' });
		const blur = timeline.timelineMotionBlur;
		if (!blur || typeof blur.enabled !== 'boolean' || !Number.isFinite(blur.shutterAngle) || blur.shutterAngle < 0 || blur.shutterAngle > 360 || !Number.isInteger(blur.samples) || blur.samples < 0 || blur.samples > 128) diagnostics.push({ code: 'timeline.motionBlur', message: 'Invalid motion blur settings' });
	}
	return diagnostics;
}
