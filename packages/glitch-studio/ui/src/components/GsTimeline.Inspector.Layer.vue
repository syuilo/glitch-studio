<template>
<GsFolder defaultOpen asSection :withSpacer="false">
	<template #icon><i class="ti ti-stack-middle"></i></template>
	<template #label>Layer: {{ layer.name }}</template>

	<div style="margin-left: 16px; border-left: solid 1px #fff2;">
		<div class="_spacer">
			<GsInput small :modelValue="layer.name" @update:modelValue="name => stateManager.commit('renameTimelineLayer', { sceneId, layerId: layer.id, name: String(name) })"><template #label>Layer Name</template></GsInput>
		</div>
		<GsTimelineEffectSettings
			v-if="layer.layerType === 'effect'"
			:key="layer.id"
			:layer="layer"
			:effectState="effectLayerState"
			:contextResolution="getSceneBaseResolution(scene.resolution, stateManager.state.resolution.value)"
			:audioLayerOptions="audioLayerOptions"
			@edit="event => onTimelineLayerParamEdit(event, 'effect')"
			@resolution="resolution => stateManager.commit('changeEffectLayerResolution', { sceneId, layerId: layer.id, resolution })"
		/>
		<GsTimelineVoicevoxSettings v-if="layer.layerType === 'voicevox'" :key="layer.id" :sceneId="sceneId" :layer="layer" @selected="keyframeId => emit('selectKeyframe', { layerId: layer.id, target: 'utterance', paramPath: ['utterances'], keyframeId })"/>
		<GsTimelineVoicevoxSubtitleSettings
			v-if="layer.layerType === 'voicevox'"
			:key="layer.id"
			:layer="layer"
			@edit="event => onTimelineLayerParamEdit(event, 'voicevoxSubtitle')"
		/>
		<GsTimelineTextSettings
			v-if="layer.layerType === 'text'"
			:key="layer.id"
			:layer="layer"
			@edit="event => onTimelineLayerParamEdit(event, 'text')"
		/>
		<GsTimelineShapeSettings
			v-if="layer.layerType === 'shape'"
			:key="layer.id"
			:layer="layer"
			@edit="event => onTimelineLayerParamEdit(event, 'shape')"
		/>
		<GsFolder v-if="layer.layerType === 'inlineVisualModule'" :asSection="true" defaultOpen :withSpacer="false">
			<template #icon><i class="ti ti-chart-dots-3"></i></template>
			<template #label>Visual Module</template>
			<div>
				<GsVisualModuleEditor
					:key="layer.id"
					:class="$style.inlineVisualModuleEditor"
					:visualModule="layer.visualModule"
					:visualModuleName="layer.name"
					:effectStates="inlineEffectStates"
					:exporting="exportingVisualModule"
					@edit="onInlineVisualModuleEdit"
					@rename="renameInlineVisualModule"
					@requestAddEffectNode="emit('requestAddInlineEffectNode', layer.id)"
					@requestExport="exportInlineVisualModule"
				/>
			</div>
		</GsFolder>
		<GsFolder v-if="visualModule != null" :asSection="true" defaultOpen :withSpacer="false">
			<template #icon><i class="ti ti-adjustments-horizontal"></i></template>
			<template #label>Module Parameters</template>
			<div style="padding: 8px 0;">
				<!-- TODO: struct / array / anyのカスタムパラメータ編集UI。型定義では許可するが、子の編集や配列操作は未対応。 -->
				<template
					v-for="paramDef of visualModule?.paramDefs.filter(paramDef => paramDef.id !== visualModule?.primaryInputId) ?? []"
					:key="`${layer.id}:${paramDef.id}`"
				>
					<div v-if="paramDef.dataType.kind === 'struct' || paramDef.dataType.kind === 'array' || isParameterType(paramDef, 'any')">{{ paramDef.ui.label }}: Editing is not yet supported.</div>
					<GsVisualParam
						v-else
						keyframesEnabled
						:automationGraphEndEnabled="false"
						:availableVariables="LAYER_VAR_DEFS"
						:automationGraphs="layer.automationGraphs"
						:paramPath="[paramDef.id]"
						:paramDef="{ ...paramDef, canNode: false }"
						:audioLayerOptions="audioLayerOptions"
						:paramValue="getLayerParameterValues(layer, 'module')[paramDef.id] ?? getTimelineVisualModuleArgumentDefault(visualModule!, paramDef)"
						@edit="event => onTimelineLayerParamEdit(event, 'module')"
					/>
				</template>
			</div>
		</GsFolder>
		<GsFolder v-if="layer.layerType !== 'audio'" :asSection="true" defaultOpen :withSpacer="false">
			<template #icon><i class="ti ti-layers-selected"></i></template>
			<template #label>Compositing</template>
			<div style="padding: 8px 0;">
				<GsVisualParam
					v-for="(paramDef, paramId) in timelineCompositingParamDefs"
					:key="paramId"
					keyframesEnabled
					:automationGraphEndEnabled="false"
					:availableVariables="LAYER_VAR_DEFS"
					:automationGraphs="layer.automationGraphs"
					:paramPath="[paramId]"
					:paramDef="paramDef"
					:paramValue="layer.compositingParamValues[paramId]"
					@edit="event => onTimelineLayerParamEdit(event, 'compositing')"
				/>
			</div>
		</GsFolder>
		<GsFolder v-if="isTimelineAudioOutputLayer(layer)" :asSection="true" defaultOpen>
			<template #icon><i class="ti ti-music"></i></template>
			<template #label>Audio</template>
			<div class="_gaps_m">
				<GsVisualParam
					:key="layer.id"
					keyframesEnabled
					:automationGraphEndEnabled="false"
					:availableVariables="LAYER_VAR_DEFS"
					:automationGraphs="layer.automationGraphs"
					:paramPath="['volume']"
					:paramDef="timelineAudioParamDefs.volume"
					:paramValue="layer.audioParamValues.volume"
					@edit="event => onTimelineLayerParamEdit(event, 'audio')"
				/>
			</div>
		</GsFolder>
		<GsFolder :asSection="true" defaultOpen>
			<template #label>Other</template>
			<div class="_gaps_m">
				<GsButton danger small @click="stateManager.commit('removeTimelineLayer', { sceneId: scene.id, layerId: layer.id })"><i class="ti ti-trash"></i> Remove Layer</GsButton>
			</div>
		</GsFolder>
	</div>
</GsFolder>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue';
import { flattenTimelineLayers } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import { isParameterType } from '@gs/shared/parameter/parameter-definition.ts';
import { LAYER_VAR_DEFS } from '@gs/subsystems_timeline_shared/expression.ts';
import { timelineAudioParamDefs, isTimelineAudioOutputLayer } from '@gs/subsystems_timeline_shared/timeline-audio.ts';
import { timelineCompositingParamDefs } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import { getSceneBaseResolution } from '@gs/subsystems_timeline_shared/scene-resolution.ts';
import { getTimelineVisualModuleArgumentDefault } from '@gs/subsystems_timeline_shared/layers/visual-module/visual-module-arguments.ts';
import type { TimelineLayer, TimelineScene } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineKeyframeSelection } from '@/utility/timeline-selection.ts';
import type { TimelineParameterTarget } from '@/utility/timeline-scene.ts';
import type { ParamEdit } from './GsVisualParam.vue';
import type { VisualModuleEdit } from '@/types/visual-module-editor.ts';
import { getLayerParameterValues } from '@/utility/timeline-scene.ts';
import { commitVisualModuleEdit } from '@/utility/visual-module-edit.ts';
import { exportVisualModuleFile } from '@/utility/visual-module-file.ts';
import { appContext } from '@/app.ts';
import GsButton from './common/GsButton.vue';
import GsFolder from './common/GsFolder.vue';
import GsInput from './common/GsInput.vue';
import GsVisualParam from './GsVisualParam.vue';
import GsVisualModuleEditor from './GsVisualModuleEditor.vue';
import GsTimelineEffectSettings from './GsTimeline.EffectSettings.vue';
import GsTimelineVoicevoxSettings from './GsTimeline.VoicevoxSettings.vue';
import GsTimelineVoicevoxSubtitleSettings from './GsTimeline.VoicevoxSubtitleSettings.vue';
import GsTimelineTextSettings from './GsTimeline.TextSettings.vue';
import GsTimelineShapeSettings from './GsTimeline.ShapeSettings.vue';

const props = defineProps<{ scene: TimelineScene; layer: TimelineLayer }>();
const emit = defineEmits<{ selectKeyframe: [selection: TimelineKeyframeSelection]; requestAddInlineEffectNode: [layerId: string] }>();
const { previewPlayback, timelineRendererManagerController } = appContext;
const { stateManager } = appContext.projectContext;
const sceneId = computed(() => props.scene.id);
const sceneLayers = computed(() => flattenTimelineLayers(props.scene.layers));
const audioLayerOptions = computed(() => sceneLayers.value
	.filter(layer => layer.id !== props.layer.id && isTimelineAudioOutputLayer(layer))
	.map(layer => ({ value: layer.id, label: layer.name })));
const visualModule = computed(() => {
	const layer = props.layer;
	return layer.layerType === 'inlineVisualModule' ? layer.visualModule
		: layer.layerType === 'visualModule' ? appContext.projectContext.getVisualModuleById(layer.visualModuleId) : null;
});
const inlineEffectStates = computed(() => previewPlayback.state.value.mode === 'timeline'
	? timelineRendererManagerController.getLayerEffectStates(props.scene.id, props.layer.id) : undefined);
const effectLayerState = computed(() => previewPlayback.state.value.mode === 'timeline' && props.layer.layerType === 'effect'
	? timelineRendererManagerController.getEffectLayerState(props.scene.id, props.layer.id) : undefined);

const exportingVisualModule = ref(false);

async function exportInlineVisualModule() {
	const layer = props.layer;
	if (layer.layerType !== 'inlineVisualModule' || exportingVisualModule.value) return;
	exportingVisualModule.value = true;
	try {
		await exportVisualModuleFile(appContext.projectContext, layer.visualModule, layer.name);
	} finally {
		exportingVisualModule.value = false;
	}
}

function renameInlineVisualModule(name: string) {
	const layer = props.layer;
	if (layer.layerType !== 'inlineVisualModule' || layer.name === name) return;
	// インラインVisual Moduleの表示名は所属レイヤーが所有し、書き出し時にもその名前を使う。
	stateManager.commit('renameTimelineLayer', { sceneId: props.scene.id, layerId: layer.id, name });
}

function onInlineVisualModuleEdit(event: VisualModuleEdit) {
	const layer = props.layer;
	if (layer.layerType !== 'inlineVisualModule') return;
	commitVisualModuleEdit(stateManager, { sceneId: props.scene.id, inlineVisualModuleLayerId: layer.id }, event);
}

function onTimelineLayerParamEdit(event: ParamEdit, target: TimelineParameterTarget) {
	const layer = props.layer;
	if (event.kind === 'node' || event.kind === 'externalCustomParameterInput') return;
	if (event.kind === 'inputSource' && (event.inputSource === 'node' || event.inputSource === 'externalCustomParameterInput')) return;
	const mergeKey = event.mergeKey != null ? JSON.stringify([layer.id, target, event.paramPath, event.mergeKey]) : undefined;
	if (event.kind === 'layerAudio' || (event.kind === 'inputSource' && (event.inputSource === 'lowerLayerAudio' || event.inputSource === 'layerAudio'))) {
		if (target === 'effect' || target === 'module') stateManager.commit('editTimelineLayerParam', { sceneId: props.scene.id, layerId: layer.id, target, paramPath: event.paramPath, edit: event }, mergeKey);
		return;
	}
	if (event.kind === 'layerInput' || (event.kind === 'inputSource' && event.inputSource === 'layerInput')) {
		if (target !== 'effect') return;
		stateManager.commit('editTimelineLayerParam', {
			sceneId: props.scene.id, layerId: layer.id, target, paramPath: event.paramPath, edit: event,
		}, mergeKey);
		return;
	}
	stateManager.commit('editTimelineLayerParam', {
		sceneId: props.scene.id, layerId: layer.id, target, paramPath: event.paramPath, edit: event,
	}, mergeKey);
}
</script>

<style module>
.inlineVisualModuleEditor {
	flex: 1;
	min-height: 0;
}
</style>
