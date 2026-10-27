import { openVideoSource } from '@gs/shared/media/video-source.ts';
import { createVideoTexture } from '@gs/shared/media/video-texture.ts';
import { createTimelineCompositor } from '../../timeline-compositor.ts';
import { TimelineCompositingParameters } from '../../timeline-compositing-parameters.ts';
import type { FileSource } from '@gs/shared/file-source.ts';
import type { TimelineCompositingObserver } from '../../timeline-compositor.ts';
import type { TimelineVideoLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { IntermediateTextureFormat } from '@gs/shared/types.ts';
import type { TimelineImage } from '../../timeline-image.ts';
import type { TimelineLayerRenderer } from '../../timeline-renderer.ts';

export type VideoTimelineLayerTiming = {
	/** ファイル読み取り・初期化・デコード・リーダー内の待機を含む取得時間。 */
	sampleWaitMs: number;
	/** GPU完了までの時間ではなく、変換・転送API・submitのCPU側の時間。 */
	uploadCpuMs: number;
};

export function createVideoTimelineLayer(layer: TimelineVideoLayer, fileSource: FileSource, options: {
	videoEnabled: boolean;
	/** 方向の編集時はレンダラーを再生成する。素材時刻の変換はTimelineRendererが担当する。 */
	reversePlayback: boolean;
	device: GPUDevice;
	vertex: GPUShaderModule;
	resolution: { width: number; height: number };
	resolutionScale: number;
	format: IntermediateTextureFormat;
	onCompositing?: TimelineCompositingObserver | null;
	onTiming?: ((timing: VideoTimelineLayerTiming) => void) | null;
}): TimelineLayerRenderer<TimelineImage> {
	// 音声だけを使用する配置は動画ソースもGPU資源も作らない。透明画像を合成すると
	// Replaceやマスクが下層を消すため、画像を返さず「映像出力なし」として扱う。
	if (!options.videoEnabled) return { evaluate: async () => ({ gpuTime: 0 }), destroy() {} };
	const source = openVideoSource(fileSource);
	const texture = createVideoTexture(options.device, options.format);
	const compositor = createTimelineCompositor(options);
	const parameters = new TimelineCompositingParameters();
	let disposed = false;
	let pending: Promise<unknown> = Promise.resolve();
	let cachedFrame: { contentTimeMs: number; sampleTimestampSeconds: number | null; foreground: TimelineImage } | null = null;
	return {
		evaluate(context, signal) {
			// 同じ配置の連続シークはデコーダーを直列に使う。待機中に不要になった要求は
			// デコードせず、完了が遅れた旧フレームも新しいテクスチャへ書き込まない。
			const render = async () => {
				if (disposed || signal.aborted) return { gpuTime: 0 };
				const timing: VideoTimelineLayerTiming | null = !context.isExport && options.onTiming != null ? { sampleWaitMs: 0, uploadCpuMs: 0 } : null;
				// 素材・再生方向・倍率はインスタンス内で不変。同じ素材時刻なら、固定された
				// ブラーの各サンプルでも読み出しとGPU転送を繰り返さない。保持するのは直前の
				// 前景だけで、別のフレームを転送すると上書きされるため過去の結果は残さない。
				if (cachedFrame?.contentTimeMs !== context.contentTimeMs) {
					const sampleStartedAt = timing != null ? performance.now() : 0;
					const sample = await source.getSample(context.contentTimeMs / 1000, options.reversePlayback);
					if (timing != null) timing.sampleWaitMs = performance.now() - sampleStartedAt;
					try {
						if (disposed || signal.aborted) return { gpuTime: 0 };
						// 要求時刻が違っても、素材のFPSや可変フレーム間隔によっては同じフレームを使う。
						// FPSから境界を推測せず、取得したtimestampで動画フレームの取り込みとGPU描画の重複を省く。
						const sampleTimestampSeconds = sample?.timestamp ?? null;
						if (cachedFrame == null || cachedFrame.sampleTimestampSeconds !== sampleTimestampSeconds) {
							// 転送中の失敗でテクスチャが変更・再確保されても、古い時刻のキャッシュを使わない。
							cachedFrame = null;
							// replaceの無変形時はcompositorが素材を直接返すため、合成前に原寸へ倍率を
							// 一度だけ適用する。後続モジュールの自動解像度は、この計算用寸法を継承する。
							const uploadStartedAt = timing != null && sample != null ? performance.now() : 0;
							const foreground: TimelineImage = sample != null ? { kind: 'texture', texture: texture.upload(sample, options.resolutionScale) }
								: { kind: 'uniform', value: [0, 0, 0, 0] };
							if (timing != null && sample != null) timing.uploadCpuMs = performance.now() - uploadStartedAt;
							cachedFrame = { contentTimeMs: context.contentTimeMs, sampleTimestampSeconds, foreground };
						} else {
							cachedFrame.contentTimeMs = context.contentTimeMs;
						}
					} finally { sample?.close(); }
				}
				if (timing != null) options.onTiming?.(timing);
				// 前景が同じでも下層入力・Scene時刻は変わり得るため、設定の評価と合成は毎回行う。
				const settings = parameters.evaluate({
					time: context.sceneTimeMs,
					isExport: context.isExport,
					coordinateSpace: layer.coordinateSpace,
					mask: layer.mask,
					layerMask: layer.layerMask,
					paramValues: layer.compositingParamValues,
					customParameters: context.customParameters,
					automationGraphs: layer.automationGraphs,
				});
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
