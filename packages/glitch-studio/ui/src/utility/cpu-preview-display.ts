import type { CpuPreviewFrame } from '@gs/glitch-studio_renderer/timeline-renderer-manager.ts';

/** レンダラーの読み戻しとUIのCanvas更新を別のスレッドで行い、表示側の完了待ちを計算側へ戻さない。 */
export function displayCpuPreviewFrame(canvas: HTMLCanvasElement, frame: CpuPreviewFrame) {
	const context = canvas.getContext('2d', { alpha: true, colorSpace: 'srgb', desynchronized: true });
	if (context == null) throw new Error('Cannot create CPU preview display context');
	if (canvas.width !== frame.width) canvas.width = frame.width;
	if (canvas.height !== frame.height) canvas.height = frame.height;
	context.putImageData(new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height, { colorSpace: 'srgb' }), 0, 0);
}
