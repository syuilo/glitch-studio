<template>
<GsFolder defaultOpen asSection :withSpacer="false">
	<template #icon><i class="ti ti-keyframe"></i></template>
	<template #label>Speech Key</template>
	<div class="_spacer _gaps_m">
		<GsInput small type="number" :min="bounds?.min ?? 0" :max="bounds?.max" :modelValue="utterance.timeMs" @update:modelValue="editTime">
			<template #label>Time</template><template #suffix>ms</template>
		</GsInput>
		<GsSelect small :modelValue="utterance.styleId" :items="voiceStyleItems" @update:modelValue="styleId => edit({ styleId })">
			<template #label>Voice / style</template>
		</GsSelect>
		<GsTextarea :modelValue="utterance.text" @update:modelValue="text => edit({ text })"><template #label>Subtitle</template></GsTextarea>
		<GsSelect small :modelValue="utterance.subtitleDuration.mode" :items="subtitleDurationModes" @update:modelValue="changeSubtitleDurationMode">
			<template #label>Subtitle duration</template>
		</GsSelect>
		<GsInput v-if="utterance.subtitleDuration.mode === 'specified'" small type="number" :min="0" :max="Number.MAX_SAFE_INTEGER - utterance.timeMs" :step="1" :modelValue="utterance.subtitleDuration.durationMs" @update:modelValue="editSubtitleDuration">
			<template #label>Display length (0 hides subtitle)</template><template #suffix>ms</template>
		</GsInput>
		<GsInput v-if="utterance.subtitleDuration.mode === 'speech'" small type="number" :min="0" :max="Number.MAX_SAFE_INTEGER - utterance.timeMs" :step="1" :modelValue="utterance.subtitleDuration.extensionMs" @update:modelValue="editSubtitleExtension">
			<template #label>Extend after speech</template><template #suffix>ms</template>
		</GsInput>
		<GsTextarea :modelValue="utterance.reading ?? ''" placeholder="Use subtitle text" @update:modelValue="reading => edit({ reading: reading.trim() || null })"><template #label>Reading (optional)</template></GsTextarea>
		<div>{{ status }}</div>
		<GsButton v-if="desktop && utterance.text" small :disabled="generating" @click="regenerate">Regenerate</GsButton>
		<GsButton danger small @click="remove"><i class="ti ti-trash"></i> Remove Speech Key</GsButton>
		<div v-if="error" :class="$style.error">{{ error }}</div>
	</div>
</GsFolder>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { getVoicevoxRequest, getVoicevoxRequestKey } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
import GsFolder from './common/GsFolder.vue';
import GsInput from './common/GsInput.vue';
import GsSelect from './common/GsSelect.vue';
import GsTextarea from './common/GsTextarea.vue';
import GsButton from './common/GsButton.vue';
import type { TimelineVoicevoxLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { VoicevoxUtterance } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
import { appContext } from '@/app.ts';
import { getDefaultVoicevoxSubtitleDuration, getVoicevoxUtteranceTimeBounds } from '@/utility/voicevox-utterance-edit.ts';

const props = defineProps<{ sceneId: string; layer: TimelineVoicevoxLayer; utterance: VoicevoxUtterance }>();
const emit = defineEmits<{ selected: [id: string] }>();
const { stateManager } = appContext.projectContext;
const desktop = window.desktop;
const { speakers } = appContext.voicevoxConnection;
const voiceStyleItems = computed(() => {
	const items = speakers.value.flatMap(speaker => speaker.styles.filter(style => !style.type || style.type === 'talk')
		.map(style => ({ value: style.id, label: `${speaker.name} / ${style.name}` })));
	// 接続前やエンジンにない声も保存したIDを表示し、別の声へ暗黙に差し替えない。
	if (!items.some(item => item.value === props.utterance.styleId)) items.unshift({
		value: props.utterance.styleId,
		label: `Style ${props.utterance.styleId} (${speakers.value.length ? 'unavailable' : 'connect to load voices'})`,
	});
	return items;
});
const error = ref('');
const subtitleDurationModes = [
	{ value: 'automatic', label: 'Automatic (until next speech key)' },
	{ value: 'specified', label: 'Specified' },
	{ value: 'speech', label: 'Match speech duration' },
];
const bounds = computed(() => getVoicevoxUtteranceTimeBounds(props.layer.utterances, props.utterance.id));
const request = computed(() => getVoicevoxRequest(props.layer.voicevox, props.utterance));
const key = computed(() => getVoicevoxRequestKey(request.value));
const generation = computed(() => appContext.voicevoxGeneration.statuses.value[key.value]);
const generating = computed(() => generation.value?.state === 'generating');
const status = computed(() => {
	if (!props.utterance.text) return 'Clear subtitle / stop speech';
	if (generating.value) return 'Generating…';
	if (generation.value?.state === 'error') return generation.value.message;
	const speech = stateManager.state.generatedSpeech.value.find(item => item.key === key.value);
	return speech ? `Ready · ${(speech.durationMs / 1000).toFixed(2)} s` : 'Not generated';
});

function commit(utterances: VoicevoxUtterance[]) {
	error.value = '';
	try {
		stateManager.commit('editVoicevoxLayer', { sceneId: props.sceneId, layerId: props.layer.id, voicevox: props.layer.voicevox, utterances });
		return true;
	} catch (cause) { error.value = String(cause); return false; }
}

function edit(patch: Partial<VoicevoxUtterance>) {
	commit(props.layer.utterances.map(utterance => utterance.id === props.utterance.id ? { ...utterance, ...patch } : utterance));
}

function editTime(value: string | number) {
	const time = Number(value);
	if (!Number.isFinite(time) || !bounds.value) return;
	edit({ timeMs: Math.max(bounds.value.min, Math.min(bounds.value.max, Math.round(time))) });
}

function changeSubtitleDurationMode(mode: string) {
	if (mode === props.utterance.subtitleDuration.mode) return;
	if (mode === 'automatic') {
		edit({ subtitleDuration: { mode: 'automatic' } });
	} else if (mode === 'specified') {
		edit({ subtitleDuration: { mode: 'specified', durationMs: getDefaultVoicevoxSubtitleDuration(props.layer.utterances, props.layer.clips, props.utterance.id, stateManager.state.generatedSpeech.value.find(speech => speech.key === key.value)?.durationMs) } });
	} else if (mode === 'speech') {
		edit({ subtitleDuration: { mode: 'speech', extensionMs: 0 } });
	}
}

function editSubtitleDuration(value: string | number) {
	if (props.utterance.subtitleDuration.mode !== 'specified') return;
	const duration = Number(value);
	if (!Number.isFinite(duration)) return;
	edit({ subtitleDuration: { mode: 'specified', durationMs: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER - props.utterance.timeMs, Math.round(duration))) } });
}

function editSubtitleExtension(value: string | number) {
	if (props.utterance.subtitleDuration.mode !== 'speech') return;
	const extension = Number(value);
	if (!Number.isFinite(extension)) return;
	edit({ subtitleDuration: { mode: 'speech', extensionMs: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER - props.utterance.timeMs, Math.round(extension))) } });
}

function remove() { commit(props.layer.utterances.filter(utterance => utterance.id !== props.utterance.id)); }

async function regenerate() {
	error.value = '';
	try { await appContext.voicevoxGeneration.generate(request.value, true); } catch (cause) { error.value = String(cause); }
}
</script>

<style module>
.error {
	color: #ff9b9b;
	white-space: pre-wrap;
}
</style>
