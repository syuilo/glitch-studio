import { ref, watch } from 'vue';
import { fpsLimit } from './app.ts';

export const currentTimelineTime = ref(0);
export const isTimelinePlaying = ref(false);
let currentTimelinePlayingRafId: number | null = null;

export function playTimeline() {
	isTimelinePlaying.value = true;

	let then = 0;

	const renderLoop = (timeStamp: number) => {
		currentTimelinePlayingRafId = window.requestAnimationFrame(renderLoop);

		const delta = timeStamp - then;
		if (fpsLimit.value != null) {
			const interval = 1000 / fpsLimit.value;
			if (delta <= interval) return;
			then = timeStamp - (delta % interval);
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
