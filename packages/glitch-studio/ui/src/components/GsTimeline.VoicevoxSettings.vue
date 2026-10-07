<template>
<GsFolder asSection defaultOpen :withSpacer="false">
	<template #icon><i class="ti ti-microphone"></i></template>
	<template #label>VOICEVOX</template>
	<div class="_spacer _gaps_m">
		<template v-if="desktop">
			<GsInput v-model="endpoint" small type="text">
				<template #label>Engine URL</template>
			</GsInput>
			<GsButton small :disabled="connecting" @click="connect">Connect</GsButton>
			<div v-if="version">Engine {{ version }}</div>
		</template>
		<div v-else>Generation requires the Electron app. Saved audio can be played here.</div>
		<GsInput small type="number" :min="0.5" :max="2" :step="0.05" :debounce="400" :modelValue="layer.voicevox.speedScale" @update:modelValue="speedScale => changeSettings({ speedScale })">
			<template #label>Speech speed</template>
		</GsInput>
		<GsButton small @click="add">Add speech key at playhead</GsButton>
		<GsButton small :disabled="layer.clips.length === 0" @click="fitLastClip">Fit last clip to speech</GsButton>
		<div>Select a speech key in the timeline to edit its voice, text and reading.</div>
		<div v-if="error" :class="$style.error">{{ error }}</div>
	</div>
</GsFolder>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { insertVoicevoxUtterance } from '@/utility/voicevox-utterance-edit.ts';
import { getVoicevoxRequest, getVoicevoxRequestKey } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
import GsFolder from './common/GsFolder.vue';
import GsButton from './common/GsButton.vue';
import GsInput from './common/GsInput.vue';
import type { VoicevoxSettings, VoicevoxUtterance } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
import type { TimelineVoicevoxLayer } from '@gs/subsystems_timeline_shared/types.ts';
import { appContext } from '@/app.ts';

const props = defineProps<{ layer: TimelineVoicevoxLayer; sceneId: string }>();
const emit = defineEmits<{ selected: [id: string] }>();
const { stateManager } = appContext.projectContext;
const desktop = window.desktop;
const { endpoint, version, speakers } = appContext.voicevoxConnection;
const connecting = ref(false);
const error = ref('');
const sortedUtterances = computed(() => props.layer.utterances.toSorted((a, b) => a.timeMs - b.timeMs));

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
		for (const [index, utterance] of sortedUtterances.value.entries()) {
			if (!utterance.text) continue;
			const nextTime = sortedUtterances.value[index + 1]?.timeMs ?? Infinity;
			if (nextTime <= clip.startMs) continue;
			const speech = stateManager.state.generatedSpeech.value.find(item => item.key === key(utterance));
			if (!speech) throw new Error('Generate the speech before fitting the clip.');
			endMs = Math.max(endMs, Math.min(utterance.timeMs + speech.durationMs, nextTime));
		}
		// 生成音声の小数msの末尾を切らないよう切り上げる。キーは動かさない。
		stateManager.commit('editTimelineClipTiming', {
			sceneId: props.sceneId, layerId: props.layer.id, clipId: clip.id,
			edge: 'end', deltaMs: Math.ceil(endMs) - (clip.startMs + clip.durationMs),
		});
	} catch (cause) { error.value = String(cause); }
}

function key(utterance: VoicevoxUtterance) { return getVoicevoxRequestKey(getVoicevoxRequest(props.layer.voicevox, utterance)); }

</script>

<style module>
.error {
	color: #ff9b9b;
	white-space: pre-wrap;
}

</style>
