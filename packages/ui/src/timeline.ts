import { ref, watch } from 'vue';
import { fpsLimit } from './app.ts';

export const currentTimelineTime = ref(0);
export const isTimelinePlaying = ref(false);
let currentTimelinePlayingRafId: number | null = null;

export function playTimeline() {
	if (isTimelinePlaying.value) return;

	isTimelinePlaying.value = true;

	let previousFrameTime: number | null = null;

	const renderLoop = (timeStamp: number) => {
		currentTimelinePlayingRafId = window.requestAnimationFrame(renderLoop);
		if (previousFrameTime == null) {
			// 再生開始・再開時は停止中の実時間を加算せず、このフレームを差分計算の基準にする。
			previousFrameTime = timeStamp;
			return;
		}

		const delta = timeStamp - previousFrameTime;
		if (fpsLimit.value != null) {
			const interval = 1000 / fpsLimit.value;
			if (delta <= interval) return;
			previousFrameTime = timeStamp - (delta % interval);
		} else {
			previousFrameTime = timeStamp;
		}

		currentTimelineTime.value = (currentTimelineTime.value + (delta)) % 10000;
	};

	currentTimelinePlayingRafId = window.requestAnimationFrame(renderLoop);
}

export function stopTimeline() {
	isTimelinePlaying.value = false;
	if (currentTimelinePlayingRafId != null) {
		window.cancelAnimationFrame(currentTimelinePlayingRafId);
		currentTimelinePlayingRafId = null;
	}
}
