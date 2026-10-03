<template>
<div :class="$style.root">
	<div :class="$style.buttons">
		<GsButton iconOnly primary :disabled="!ready" :title="paused ? i18n.ts._VideoControls.Play : i18n.ts._VideoControls.Pause" @click="togglePlayback">
			<i :class="paused ? 'ti ti-player-play' : 'ti ti-player-pause'"></i>
		</GsButton>
		<GsButton iconOnly :disabled="!ready" :title="i18n.ts._VideoControls.Stop" @click="stop">
			<i class="ti ti-player-stop"></i>
		</GsButton>
	</div>
	<div>
		<div :class="$style.time" class="_monospace" style="display: flex;">
			<span>{{ formatTime(currentTime) }}</span>
			<span style="margin-left: auto;">-{{ formatTime(Math.abs(currentTime - duration)) }}</span>
		</div>
		<div v-if="isVideo" :class="$style.time" class="_monospace">{{ currentFrame ?? '—' }}</div>
	</div>
	<div :class="$style.seekBar">
		<GsMediaRange
			v-model="rangePercent"
			:buffer="bufferedDataRatio"
		/>
	</div>
	<!-- 音量調整はそれを利用するノード側の役目。「動画の明るさ調整」などというコントロールが無いのと一緒
	<label>
		<i class="ti ti-volume"></i>
		<span>{{ i18n.ts._VideoControls.Volume }}</span>
		<input :class="$style.slider" type="range" min="0" max="1" step="0.01" :value="volume" :disabled="!video" @input="setVolume"/>
		<span>{{ Math.round(volume * 100) }}%</span>
	</label>
	-->
	<div>
		<div :class="$style.time" class="_monospace">Total: {{ formatTime(duration) }}</div>
	</div>
	<div v-if="error" role="alert">{{ error }}</div>
</div>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import GsButton from './GsButton.vue';
import GsInput from './GsInput.vue';
import GsMediaRange from './GsMediaRange.vue';
import { i18n } from '@/i18n.ts';

const props = defineProps<{
	video: HTMLMediaElement | null;
	play?: () => Promise<void>;
	//getVolume?: () => number;
	//setVolume?: (volume: number) => void;
}>();

const paused = ref(true);
const ready = ref(false);
const currentTime = ref(0);
const duration = ref(0);
const frameRate = ref(30);
const frameTime = ref<number | null>(null);
const isVideo = computed(() => props.video instanceof HTMLVideoElement);
const currentFrame = computed(() => {
	if (frameTime.value === null || !Number.isFinite(frameRate.value) || frameRate.value <= 0) return null;
	// 指定FPSで固定フレームレートと仮定した0始まりの番号。時刻の丸め誤差を吸収する。
	return Math.max(0, Math.round(frameTime.value * frameRate.value));
});
const totalFrames = computed(() => {
	if (frameTime.value === null || !Number.isFinite(frameRate.value) || frameRate.value <= 0) return null;
	return Math.max(0, Math.round(duration.value * frameRate.value));
});
const rangePercent = computed({
	get: () => {
		return (currentTime.value / duration.value) || 0;
	},
	set: (to) => {
		if (props.video == null) return;
		props.video.currentTime = to * duration.value;
		currentTime.value = props.video.currentTime;
	},
});
const bufferedEnd = ref(0);
const bufferedDataRatio = computed(() => {
	if (duration.value === 0) return 0;
	return bufferedEnd.value / (duration.value);
});
//const volume = ref(0.5);
const error = ref('');

watch(() => props.video, (video, _, onCleanup) => {
	error.value = '';
	frameTime.value = null;
	let animationFrameId: number | null = null;
	let videoFrameCallbackId: number | null = null;
	const updateCurrentTime = () => {
		animationFrameId = null;
		currentTime.value = video?.currentTime ?? 0;
		if (video && !video.paused && !video.ended && !video.error) {
			animationFrameId = requestAnimationFrame(updateCurrentTime);
		}
	};
	const sync = () => {
		paused.value = video?.paused ?? true;
		// Keep controls enabled while the frame at the seek destination is loading.
		ready.value = video != null && video.readyState >= video.HAVE_METADATA && !video.error;
		currentTime.value = video?.currentTime ?? 0;
		duration.value = video && Number.isFinite(video.duration) ? video.duration : 0;
		if (!video || video.readyState === video.HAVE_NOTHING) frameTime.value = null;
		if (video && !video.paused && !video.ended && !video.error) {
			if (animationFrameId === null) animationFrameId = requestAnimationFrame(updateCurrentTime);
		} else if (animationFrameId !== null) {
			cancelAnimationFrame(animationFrameId);
			animationFrameId = null;
		}
		//volume.value = props.getVolume ? props.getVolume() : video?.muted ? 0 : (video?.volume ?? 0.5);
		syncBuffered();
	};
	sync();
	if (!video) return;
	if (video instanceof HTMLVideoElement) {
		const updateFrame: Parameters<HTMLVideoElement['requestVideoFrameCallback']>[0] = (_now, metadata) => {
			frameTime.value = metadata.mediaTime;
			videoFrameCallbackId = video.requestVideoFrameCallback(updateFrame);
		};
		// 一時停止中も登録を維持し、シークで表示されるフレームを受け取る。
		videoFrameCallbackId = video.requestVideoFrameCallback(updateFrame);
	}
	const events = ['play', 'pause', 'ended', 'timeupdate', 'seeking', 'seeked', 'loadeddata', 'loadedmetadata', 'durationchange', 'volumechange', 'emptied', 'error'] as const;
	for (const event of events) video.addEventListener(event, sync);
	onCleanup(() => {
		if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
		if (video instanceof HTMLVideoElement && videoFrameCallbackId !== null) video.cancelVideoFrameCallback(videoFrameCallbackId);
		for (const event of events) video.removeEventListener(event, sync);
	});
}, { immediate: true });

async function togglePlayback() {
	const video = props.video;
	if (!video) return;
	error.value = '';
	if (!video.paused) {
		video.pause();
		return;
	}
	try {
		await (props.play ? props.play() : video.play());
	} catch (err) {
		if (props.video === video && !(err instanceof DOMException && err.name === 'AbortError')) {
			error.value = String(err);
		}
	}
}

function stop() {
	if (!props.video) return;
	props.video.pause();
	props.video.currentTime = 0;
	currentTime.value = 0;
}

function syncBuffered() {
	const buffered = props.video?.buffered;
	if (buffered == null || buffered.length === 0) {
		bufferedEnd.value = 0;
		return;
	}

	// シークすると読み込み済みの範囲が複数に分かれるため、最も先まで到達している位置を採用する
	let end = 0;
	for (let i = 0; i < buffered.length; i++) {
		if (buffered.end(i) > end) end = buffered.end(i);
	}
	bufferedEnd.value = end;
}

/*
function setVolume(event: Event) {
	if (!props.video) return;
	if (props.setVolume) {
		props.setVolume((event.target as HTMLInputElement).valueAsNumber);
		return;
	}
	props.video.volume = (event.target as HTMLInputElement).valueAsNumber;
	props.video.muted = false;
}
*/

function formatTime(value: number): string {
	const totalMilliseconds = Math.floor(value * 1000);
	const hours = String(Math.floor(totalMilliseconds / 3600000)).padStart(2, '0');
	const minutes = String(Math.floor(totalMilliseconds / 60000) % 60).padStart(2, '0');
	const seconds = String(Math.floor(totalMilliseconds / 1000) % 60).padStart(2, '0');
	const milliseconds = String(totalMilliseconds % 1000).padStart(3, '0');
	return `${hours}:${minutes}:${seconds}.${milliseconds}`;
}
</script>

<style module lang="scss">
.root {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.buttons {
	display: flex;
	align-items: center;
	gap: 8px;
}

.seekBar {
	flex: 1;
	min-width: 0;
	width: 100%;
}

.time {
	font-variant-numeric: tabular-nums;
}

.frameRate {
	flex: 0 0 100px;
	min-width: 0;
}
</style>
