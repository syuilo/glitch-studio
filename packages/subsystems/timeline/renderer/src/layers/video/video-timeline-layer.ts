import type { FileSource } from '@gs/shared/file-source.ts';
import { openVideoSource } from '@gs/shared/media/video-source.ts';
import { createVideoTexture } from '@gs/shared/media/video-texture.ts';
import { createTimelineCompositor } from '../../timeline-compositor.ts';
import { TimelineCompositingParameters } from '../../timeline-compositing-parameters.ts';
import type { TimelineCompositingObserver } from '../../timeline-compositor.ts';
import type { TimelineVideoLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { IntermediateTextureFormat } from '@gs/shared/types.ts';
import type { TimelineImage } from '../../timeline-image.ts';
import type { TimelineLayerRenderer } from '../../timeline-renderer.ts';

export function createVideoTimelineLayer(layer: TimelineVideoLayer, fileSource: FileSource, options: {
	/** 方向の編集時はレンダラーを再生成する。素材時刻の変換はTimelineRendererが担当する。 */
	reversePlayback: boolean;
	device: GPUDevice;
	vertex: GPUShaderModule;
	resolution: { width: number; height: number };
	resolutionScale: number;
	format: IntermediateTextureFormat;
	onCompositing?: TimelineCompositingObserver | null;
}): TimelineLayerRenderer<TimelineImage> {
	const source = openVideoSource(fileSource);
	const texture = createVideoTexture(options.device, options.format);
	const compositor = createTimelineCompositor(options);
	const parameters = new TimelineCompositingParameters();
	let disposed = false;
	let pending: Promise<unknown> = Promise.resolve();
	let cachedFrame: { contentTimeMs: number; foreground: TimelineImage } | null = null;
	return {
		evaluate(context, signal) {
			// 同じ配置の連続シークはデコーダーを直列に使う。待機中に不要になった要求は
			// デコードせず、完了が遅れた旧フレームも新しいテクスチャへ書き込まない。
			const render = async () => {
				if (disposed || signal.aborted) return { gpuTime: 0 };
				// 素材・再生方向・倍率はインスタンス内で不変。同じ素材時刻なら、固定された
				// ブラーの各サンプルでも読み出しとGPU転送を繰り返さない。保持するのは直前の
				// 前景だけで、時刻が変われば同じテクスチャを書き換えるため過去の結果は残さない。
				if (cachedFrame?.contentTimeMs !== context.contentTimeMs) {
					const sample = await source.getSample(context.contentTimeMs / 1000, options.reversePlayback);
					try {
						if (disposed || signal.aborted) return { gpuTime: 0 };
						// 転送中の失敗でテクスチャが変更・再確保されても、古い時刻のキャッシュを使わない。
						cachedFrame = null;
						// replaceの無変形時はcompositorが素材を直接返すため、合成前に原寸へ倍率を
						// 一度だけ適用する。後続モジュールの自動解像度は、この計算用寸法を継承する。
						const foreground: TimelineImage = sample ? { kind: 'texture', texture: texture.upload(sample, options.resolutionScale) }
							: { kind: 'uniform', value: [0, 0, 0, 0] };
						cachedFrame = { contentTimeMs: context.contentTimeMs, foreground };
					} finally { sample?.close(); }
				}
				// 前景が同じでも下層入力・Scene時刻は変わり得るため、設定の評価と合成は毎回行う。
				const settings = parameters.evaluate({ time: context.sceneTimeMs, isExport: context.isExport, coordinateSpace: layer.coordinateSpace, mask: layer.mask, paramValues: layer.compositingParamValues, automationGraphs: layer.automationGraphs });
				return compositor.evaluate(context, cachedFrame.foreground, settings);
			};
			const result = pending.then(render);
			pending = result.catch(() => {});
			return result;
		},
		destroy() {
			disposed = true;
			cachedFrame = null;
			source.dispose();
			texture.dispose();
			compositor.dispose();
		},
	};
}
