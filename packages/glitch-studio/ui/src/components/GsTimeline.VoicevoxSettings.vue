<template>
<GsFolder asSection defaultOpen :withSpacer="false">
	<template #icon><i class="ti ti-microphone"></i></template>
	<template #label>VOICEVOX</template>
	<div class="_spacer _gaps_m">
		<template v-if="desktop">
			<div style="display: flex; align-items: center; gap: 8px;">
				<GsInput v-model="endpoint" small type="text" style="flex: 1; min-width: 0;">
					<template #label>Engine URL</template>
					<template v-if="version != null && version !== ''" #caption><span style="color: var(--THEME-success);"><i class="ti ti-check"></i> Connected: Engine {{ version }}</span></template>
				</GsInput>
				<GsButton small primary :disabled="connecting" @click="connect">Connect</GsButton>
			</div>
		</template>
		<div v-else>Generation requires the Electron app. Saved audio can be played here.</div>
		<GsInput small type="number" :min="0.5" :max="2" :step="0.05" :debounce="400" :modelValue="layer.voicevox.speedScale" @update:modelValue="speedScale => changeSettings({ speedScale })">
			<template #label>Speech speed</template>
		</GsInput>
		<hr>
		<GsButton primary small @click="add"><i class="ti ti-plus"></i> Add Speech Key at Playhead</GsButton>
		<GsButton v-if="layer.clips.length > 0" small @click="fitLastClip">Fit Last Clip to Speech</GsButton>
		<div v-if="error" :class="$style.error">{{ error }}</div>
	</div>
</GsFolder>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { createSpeechResolver } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
import { assignPreparedSpeech, getVoicevoxUtteranceIntervals } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox-placement.ts';
import GsFolder from './common/GsFolder.vue';
import GsButton from './common/GsButton.vue';
import GsInput from './common/GsInput.vue';
import type { VoicevoxSettings, VoicevoxUtterance } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
import type { TimelineVoicevoxLayer } from '@gs/subsystems_timeline_shared/types.ts';
import { insertVoicevoxUtterance } from '@/utility/voicevox-utterance-edit.ts';
import { appContext } from '@/app.ts';

const props = defineProps<{ layer: TimelineVoicevoxLayer; sceneId: string }>();
const emit = defineEmits<{ selected: [id: string] }>();
const { stateManager } = appContext.projectContext;
const desktop = window.desktop;
const { endpoint, version, speakers } = appContext.voicevoxConnection;
const connecting = ref(false);
const error = ref('');

async function connect() {
	connecting.value = true;
	error.value = '';
	try {
		const result = await desktop!.voicevoxConnect(endpoint.value);
		version.value = result.version;
		speakers.value = result.speakers;
		appContext.voicevoxGeneration.schedule();
	} catch (cause) { error.value = String(cause); } finally { connecting.value = false; }
}

function commit(utterances: VoicevoxUtterance[], voicevox = props.layer.voicevox) {
	error.value = '';
	try { stateManager.commit('editVoicevoxLayer', { sceneId: props.sceneId, layerId: props.layer.id, voicevox, utterances }); } catch (cause) { error.value = String(cause); }
}

function changeSettings(settings: Partial<VoicevoxSettings>) { commit(props.layer.utterances, { ...props.layer.voicevox, ...settings }); }

function add() {
	const inserted = insertVoicevoxUtterance(props.layer.utterances, appContext.previewPlayback.currentTimelineTime.value);
	if (!inserted) return;
	if (inserted.utterances !== props.layer.utterances) commit([...inserted.utterances]);
	emit('selected', inserted.utterance.id);
}

function fitLastClip() {
	error.value = '';
	const clip = props.layer.clips.toSorted((a, b) => a.startMs - b.startMs).at(-1);
	if (!clip) return;
	try {
		let endMs = clip.startMs + 1;
		const resolveSpeech = createSpeechResolver(stateManager.state.generatedSpeech.value);
		// 長さを延長する操作なので、現在のクリップ終端を適用する前の発話区間を使う。
		for (const interval of getVoicevoxUtteranceIntervals(props.layer.voicevox, props.layer.utterances)) {
			if (interval.endMs <= clip.startMs) continue;
			const speech = resolveSpeech(interval.request);
			if (!speech) throw new Error('Generate the speech before fitting the clip.');
			const ready = assignPreparedSpeech(interval, speech);
			if (ready) endMs = Math.max(endMs, ready.endMs);
		}
		// 生成音声の小数msの末尾を切らないよう切り上げる。キーは動かさない。
		stateManager.commit('editTimelineClipTiming', {
			sceneId: props.sceneId, layerId: props.layer.id, clipId: clip.id,
			edge: 'end', deltaMs: Math.ceil(endMs) - (clip.startMs + clip.durationMs),
		});
	} catch (cause) { error.value = String(cause); }
}

</script>

<style module>
.error {
	color: #ff9b9b;
	white-space: pre-wrap;
}

</style>
