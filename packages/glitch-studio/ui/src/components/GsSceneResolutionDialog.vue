<template>
<GsModal ref="modal" preferType="dialog" @opened="dialogContent?.focus()" @closed="emit('closed')" @esc="closeDialog" @click="closeDialog">
	<div ref="dialogContent" class="_gaps_m" :class="$style.root" tabindex="-1" @keydown.stop @keydown.esc.prevent="closeDialog">
		<div>Scene resolution — {{ scene?.name }}</div>
		<GsSelect v-model="mode" :items="modes"><template #label>Resolution</template></GsSelect>
		<div v-if="mode === 'customAbsolute'" :class="$style.row">
			<GsInput v-model="width" type="number" :min="1" :step="1"><template #label>Width</template><template #suffix>px</template></GsInput>
			<GsInput v-model="height" type="number" :min="1" :step="1"><template #label>Height</template><template #suffix>px</template></GsInput>
		</div>
		<div v-else>{{ projectResolution.width }} × {{ projectResolution.height }} px</div>
		<div>Base size. Preview and export resolution scales also apply to custom sizes.</div>
		<div v-if="error">{{ error }}</div>
		<div :class="$style.actions">
			<GsButton inline @click="closeDialog">Cancel</GsButton>
			<GsButton inline primary :disabled="error != null || scene == null" @click="apply">Apply</GsButton>
		</div>
	</div>
</GsModal>
</template>

<script lang="ts" setup>
import { appContext } from '@/app.ts';
import { computed, ref, useTemplateRef } from 'vue';
import { getSceneBaseResolution, validateSceneResolution } from '@gs/subsystems_timeline_shared/scene-resolution.ts';
import GsModal from './common/GsModal.vue';
import GsSelect from './common/GsSelect.vue';
import GsInput from './common/GsInput.vue';
import GsButton from './common/GsButton.vue';
import type { TimelineSceneResolution } from '@gs/subsystems_timeline_shared/scene-resolution.ts';

const { stateManager } = appContext.projectContext;

const props = defineProps<{ sceneId: string }>();
const emit = defineEmits<{ (ev: 'closed'): void }>();
const modal = useTemplateRef('modal');
const dialogContent = useTemplateRef('dialogContent');
const scene = computed(() => stateManager.state.timelineScenes.value.find(entry => entry.id === props.sceneId));
const projectResolution = stateManager.state.resolution;
const initialSetting: TimelineSceneResolution = scene.value?.resolution ?? { mode: 'project' };
const initialSize = getSceneBaseResolution(initialSetting, projectResolution.value);
const mode = ref(initialSetting.mode);
const width = ref<number | null>(initialSize.width);
const height = ref<number | null>(initialSize.height);
const modes = [{ value: 'project', label: 'Project resolution' }, { value: 'customAbsolute', label: 'Custom (Absolute)' }];
const setting = computed<TimelineSceneResolution>(() => mode.value === 'project' ? { mode: 'project' }
	: { mode: 'customAbsolute', width: width.value ?? 0, height: height.value ?? 0 });
const error = computed(() => {
	try {
		validateSceneResolution(setting.value);
		return null;
	} catch {
		return 'Width and height must be positive integers.';
	}
});

function closeDialog() { modal.value?.close(); }

function apply() {
	if (error.value != null || scene.value == null) return;
	stateManager.commit('changeSceneResolution', { sceneId: props.sceneId, resolution: setting.value });
	closeDialog();
}
</script>

<style module lang="scss">
.root {
	width: 400px;
	max-width: 85vw;
	padding: 24px;
	background: var(--THEME-dialog);
	border-radius: 12px;
}
.row {
	display: flex;
	gap: 12px;
	> * { flex: 1; min-width: 0; }
}
.actions {
	display: flex;
	justify-content: flex-end;
	gap: 12px;
}
</style>
