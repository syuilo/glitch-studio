<template>
<GsFolder defaultOpen asSection :withSpacer="false">
	<template #icon><i class="ti ti-stack-middle"></i></template>
	<template #label>{{ i18n.ts._TimelineLayer.Title }}: {{ layer.name }}</template>

	<div>
		<div class="_spacer">
			<GsInput data-test-layer-name :modelValue="layer.name" @update:modelValue="name => stateManager.commit('renameTimelineLayer', { sceneId, layerId: layer.id, name: String(name) })"><template #label>{{ i18n.ts._TimelineLayer.Name }}</template></GsInput>
		</div>
		<div class="_spacer _gaps_m">
			<GsSwitch data-test-layer-custom-color :modelValue="layer.color != null" @update:modelValue="enabled => setColor(enabled ? [0.5, 0.5, 0.5, 1] : null)">
				<template #label>{{ i18n.ts._TimelineLayer.LayerColor }}</template>
			</GsSwitch>
			<GsColorInput v-if="layer.color != null" :key="layer.id" data-test-layer-color :modelValue="layer.color" :title="i18n.ts._TimelineLayer.LayerColor" @beginChanging="beginColorEdit" @update:modelValue="setColor" @changeFinished="finishColorEdit"/>
		</div>
		<div v-if="isTimelineContainerLayer(layer)" class="_spacer">
			<GsSelect data-test-timeline-container-type large :disabled="getTimelineContainerConversionTargets(layer).length === 0" :modelValue="layer.layerType" :items="[{ value: layer.layerType, label: getTimelineContainerTypeLabel(layer.layerType) }, ...getTimelineContainerConversionTargets(layer).map(type => ({ value: type, label: getTimelineContainerTypeLabel(type) }))]" @update:modelValue="changeContainerType">
				<template #label>{{ i18n.ts._TimelineLayer.ContainerType }}</template>
				<template #caption>{{ i18n.ts._TimelineLayer.ContainerConversionHint }}</template>
			</GsSelect>
		</div>
		<div v-if="layer.layerType === 'group'" class="_spacer">
			<GsSelect large :modelValue="layer.compositingMode ?? 'flat'" :items="groupModes" @update:modelValue="mode => stateManager.commit('changeTimelineGroupMode', { sceneId, layerId: layer.id, mode })">
				<template #label>{{ i18n.ts._TimelineLayer.GroupCompositing }}</template>
			</GsSelect>
		</div>
		<GsTimelineCustomParameters v-if="hasTimelineLayerParameters(layer)" :key="layer.id" :scene="scene" :layer="layer" @edit="event => onTimelineLayerParamEdit(event, 'customParameter')"/>
		<GsTimelineEffectSettings
			v-if="layer.layerType === 'effect'"
			:key="layer.id"
			:layer="layer"
			:effectState="effectLayerState"
			:contextResolution="getSceneBaseResolution(scene.resolution, stateManager.state.resolution.value)"
			:anotherLayerAudioOptions="anotherLayerAudioOptions"
			:imageLayerOptions="imageLayerOptions"
			@staticSetting="edit => stateManager.commit('changeTimelineStaticSetting', { sceneId, layerId: layer.id, ...edit })"
			@edit="event => onTimelineLayerParamEdit(event, 'effect')"
			@resolution="resolution => stateManager.commit('changeEffectLayerResolution', { sceneId, layerId: layer.id, resolution })"
		/>
		<GsTimelineVoicevoxSettings v-if="layer.layerType === 'voicevox'" :key="layer.id" :sceneId="sceneId" :layer="layer" @expandRequested="emit('expandRequested', layer.id)" @selected="keyframeId => emit('selectKeyframe', { layerId: layer.id, target: 'utterance', paramPath: ['utterances'], keyframeId })"/>
		<GsTimelineVoicevoxSubtitleSettings
			v-if="layer.layerType === 'voicevox'"
			:key="layer.id"
			:layer="layer"
			@staticSetting="edit => stateManager.commit('changeTimelineStaticSetting', { sceneId, layerId: layer.id, ...edit })"
			@edit="event => onTimelineLayerParamEdit(event, 'voicevoxSubtitle')"
		/>
		<GsTimelineTextSettings
			v-if="layer.layerType === 'text'"
			:key="layer.id"
			:layer="layer"
			@staticSetting="edit => stateManager.commit('changeTimelineStaticSetting', { sceneId, layerId: layer.id, ...edit })"
			@edit="event => onTimelineLayerParamEdit(event, 'text')"
		/>
		<GsTimelineTransformSettings
			v-if="layer.layerType === 'transform'"
			:key="layer.id"
			:layer="layer"
			@edit="event => onTimelineLayerParamEdit(event, 'transform')"
			@motionBlur="forceDisableMotionBlur => stateManager.commit('setTimelineLayerMotionBlurDisabled', { sceneId, layerId: layer.id, forceDisableMotionBlur })"
		/>
		<GsTimelineCameraSettings
			v-if="layer.layerType === 'camera'"
			:key="layer.id"
			:layer="layer"
			@edit="event => onTimelineLayerParamEdit(event, 'camera')"
			@motionBlur="forceDisableMotionBlur => stateManager.commit('setTimelineLayerMotionBlurDisabled', { sceneId, layerId: layer.id, forceDisableMotionBlur })"
		/>
		<GsTimelineShapeSettings
			v-if="layer.layerType === 'shape'"
			:key="layer.id"
			:layer="layer"
			@edit="event => onTimelineLayerParamEdit(event, 'shape')"
		/>

		<GsFolder v-if="layer.layerType === 'inlineVisualModule'" :asSection="true" defaultOpen :withSpacer="false">
			<template #icon><i class="ti ti-chart-dots-3"></i></template>
			<template #label>{{ i18n.ts.VisualModule }}</template>
			<div>
				<GsVisualModuleEditor
					:key="layer.id"
					:class="$style.inlineVisualModuleEditor"
					:visualModule="layer.visualModule"
					:visualModuleName="layer.name"
					:assetDropActions="inlineAssetDropActions"
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
			<template #label>{{ i18n.ts._TimelineLayer.VisualModuleParameters }}</template>
			<div style="padding: 8px 0;">
				<!-- TODO: struct / arrayのカスタムパラメータ編集UI。型定義では許可するが、子の編集や配列操作は未対応。 -->
				<template
					v-for="paramDef of visualModule?.paramDefs ?? []"
					:key="`${layer.id}:${paramDef.id}`"
				>
					<div v-if="paramDef.dataType.kind === 'struct' || paramDef.dataType.kind === 'array'">{{ paramDef.ui.label }}{{ i18n.ts._TimelineLayer.EditingUnsupported }}</div>
					<GsVisualParam
						v-else
						keyframesEnabled
						:automationGraphEndEnabled="false"
						:availableVariables="LAYER_VAR_DEFS"
						:automationGraphs="hasTimelineLayerParameters(layer) ? layer.automationGraphs : []"
						:projectAutomationGraphs="appContext.projectContext.stateManager.state.automationGraphs.value"
						:data-test-visual-module-argument="paramDef.id"
						:paramPath="[paramDef.id]"
						:paramDef="paramDef"
						imageInputEnabled
						:anotherLayerAudioOptions="anotherLayerAudioOptions"
						:imageLayerOptions="imageLayerOptions"
						:paramValue="getLayerParameterValues(layer, 'module')[paramDef.id] ?? getTimelineVisualModuleArgumentDefault(visualModule!, paramDef)"
						@edit="event => onTimelineLayerParamEdit(event, 'module')"
					/>
				</template>
			</div>
		</GsFolder>

		<GsFolder v-if="isTimelineVisualLayer(layer)" :asSection="true" defaultOpen :withSpacer="false">
			<template #icon><i class="ti ti-layers-selected"></i></template>
			<template #label>{{ i18n.ts._TimelineLayer.Compositing }}</template>
			<div class="_spacer _gaps_m">
				<div>
					<template v-for="(paramDef, paramId) in getTimelineCompositingParameterDefinitions(layer.mask)" :key="paramId">
						<GsVisualParam
							v-if="(paramId !== 'blendMode' || layer.mask == null) && (getTimelineLayerTransformTarget(layer) !== 'region' || (paramId !== 'fitMode' && paramId !== 'clipToFrame'))"
							:data-test-timeline-compositing-parameter="paramId"
							keyframesEnabled
							:automationGraphEndEnabled="false"
							:availableVariables="LAYER_VAR_DEFS"
							:automationGraphs="hasTimelineLayerParameters(layer) ? layer.automationGraphs : []"
							:projectAutomationGraphs="appContext.projectContext.stateManager.state.automationGraphs.value"
							:paramPath="[paramId]"
							:paramDef="paramDef"
							:paramValue="layer.compositingParamValues[paramId] ?? paramDef.defaultValue"
							@edit="event => onTimelineLayerParamEdit(event, 'compositing')"
						/>
					</template>
				</div>
				<GsSwitch data-test-timeline-composite-inclusion :modelValue="layer.isIncludedInComposite" :helpText="i18n.ts._TimelineLayer.IncludeInCompositeHint" @update:modelValue="isIncludedInComposite => stateManager.commit('setTimelineLayerCompositeInclusion', { sceneId, layerId: layer.id, isIncludedInComposite })">
					<template #label>{{ i18n.ts._TimelineLayer.IncludeInComposite }}</template>
				</GsSwitch>
				<template v-if="isTimelineEffectOrVisualModuleLayer(layer)">
					<GsSelect large data-test-timeline-transform-target :modelValue="layer.transformTarget ?? 'image'" :items="transformTargets" @update:modelValue="transformTarget => stateManager.commit('setTimelineLayerTransformTarget', { sceneId, layerId: layer.id, transformTarget })">
						<template #label>{{ i18n.ts._TimelineLayer.TransformTarget }}</template>
					</GsSelect>
				</template>
				<GsSelect large :modelValue="layer.coordinateSpace" :items="coordinateSpaces" @update:modelValue="coordinateSpace => stateManager.commit('setTimelineLayerCoordinateSpace', { sceneId, layerId: layer.id, coordinateSpace })">
					<template #label>{{ i18n.ts._TimelineLayer.CoordinateSpace }}</template>
				</GsSelect>
			</div>
		</GsFolder>

		<GsFolder v-if="isTimelineVisualLayer(layer)" :asSection="true" defaultOpen :withSpacer="false">
			<template #icon><i class="ti ti-mask"></i></template>
			<template #label>{{ i18n.ts._TimelineLayer.Mask }}</template>
			<div class="_spacer _gaps_m">
				<GsSelect large data-test-timeline-layer-mask-source :modelValue="layer.layerMask?.sourceLayerId ?? null" :items="layerMaskSourceOptions" @update:modelValue="setLayerMaskSource">
					<template #label>{{ i18n.ts._TimelineLayer.MaskSource }} <div v-tooltip:dialog="i18n.ts._TimelineLayer.MaskSourceHint" class="_button _help"><i class="ti ti-help-circle"></i></div></template>
				</GsSelect>
				<template v-if="layer.layerMask != null">
					<GsSelect large data-test-timeline-layer-mask-channel :modelValue="layer.layerMask.channel" :items="maskChannels" @update:modelValue="channel => updateLayerMask({ channel })">
						<template #label>{{ i18n.ts._TimelineLayer.MaskChannel }}</template>
					</GsSelect>
					<GsSwitch data-test-timeline-layer-mask-inverted :modelValue="layer.layerMask.inverted" @update:modelValue="inverted => updateLayerMask({ inverted })">
						<template #label>{{ i18n.ts._TimelineLayer.InvertMask }}</template>
					</GsSwitch>
				</template>
				<hr>
				<GsSwitch data-test-timeline-mask-enabled :modelValue="layer.mask != null" @update:modelValue="enabled => setMask(enabled ? { channel: 'alpha', inverted: false } : null)">
					<template #label>{{ i18n.ts._TimelineLayer.UseAsMask }}</template>
				</GsSwitch>
				<template v-if="layer.mask != null">
					<GsSelect large data-test-timeline-mask-channel :modelValue="layer.mask.channel" :items="maskChannels" @update:modelValue="channel => updateMask({ channel })">
						<template #label>{{ i18n.ts._TimelineLayer.MaskChannel }}</template>
					</GsSelect>
					<GsSwitch data-test-timeline-mask-inverted :modelValue="layer.mask.inverted" @update:modelValue="inverted => updateMask({ inverted })">
						<template #label>{{ i18n.ts._TimelineLayer.InvertMask }}</template>
					</GsSwitch>
				</template>
			</div>
		</GsFolder>

		<GsFolder v-if="isTimelineAudioOutputLayer(layer)" :asSection="true" defaultOpen>
			<template #icon><i class="ti ti-music"></i></template>
			<template #label>{{ i18n.ts.Audio }}</template>
			<div class="_gaps_m">
				<GsVisualParam
					:key="layer.id"
					keyframesEnabled
					:automationGraphEndEnabled="false"
					:availableVariables="LAYER_VAR_DEFS"
					:automationGraphs="hasTimelineLayerParameters(layer) ? layer.automationGraphs : []"
					:projectAutomationGraphs="appContext.projectContext.stateManager.state.automationGraphs.value"
					:paramPath="['volume']"
					:paramDef="timelineAudioParamDefs.volume"
					:paramValue="layer.audioParamValues.volume"
					@edit="event => onTimelineLayerParamEdit(event, 'audio')"
				/>
			</div>
		</GsFolder>

		<GsFolder :asSection="true" defaultOpen>
			<template #label>{{ i18n.ts.Other }}</template>
			<div class="_gaps_m">
				<GsSwitch v-if="isTimelineVisualLayer(layer)" :modelValue="layer.forceDisableMotionBlur" @update:modelValue="forceDisableMotionBlur => stateManager.commit('setTimelineLayerMotionBlurDisabled', { sceneId, layerId: layer.id, forceDisableMotionBlur })">
					<template #label>{{ i18n.ts._TimelineLayer.DisableMotionBlur }}</template>
				</GsSwitch>

				<GsButton danger icon="ti ti-trash" @click="stateManager.commit('removeTimelineLayer', { sceneId: scene.id, layerId: layer.id })">{{ i18n.ts._TimelineLayer.Remove }}</GsButton>
			</div>
		</GsFolder>
	</div>
</GsFolder>
</template>

<script lang="ts" setup>
import { computed, ref, onBeforeUnmount, provide } from 'vue';
import { isTimelineVisualLayer, isTimelineContainerLayer, hasTimelineLayerParameters, isTimelineEffectOrVisualModuleLayer, getTimelineLayerTransformTarget } from '@gs/subsystems_timeline_shared/types.ts';
import { flattenTimelineLayers } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import { getTimelineLayerMaskSources } from '@gs/subsystems_timeline_shared/layer-output.ts';
import { LAYER_VAR_DEFS } from '@gs/subsystems_timeline_shared/expression.ts';
import { timelineAudioParamDefs, isTimelineAudioOutputLayer } from '@gs/subsystems_timeline_shared/timeline-audio.ts';
import { getTimelineCompositingParameterDefinitions } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import { getSceneBaseResolution } from '@gs/subsystems_timeline_shared/scene-resolution.ts';
import { getTimelineVisualModuleArgumentDefault } from '@gs/subsystems_timeline_shared/layers/visual-module/visual-module-arguments.ts';
import { getTimelineContainerConversionTargets } from '@gs/subsystems_timeline_shared/container-layer.ts';
import type { TimelineContainerLayerType } from '@gs/subsystems_timeline_shared/container-layer.ts';
import { getTimelineContainerTypeLabel } from '@/utility/container-timeline-layer.ts';
import GsSelect from './common/GsSelect.vue';
import GsButton from './common/GsButton.vue';
import GsFolder from './common/GsFolder.vue';
import GsInput from './common/GsInput.vue';
import GsSwitch from './common/GsSwitch.vue';
import GsColorInput from './common/GsColorInput.vue';
import GsVisualParam from './GsVisualParam.vue';
import GsTimelineCustomParameters from './GsTimeline.CustomParameters.vue';
import { getTimelineLayerCustomParameterContext } from '@gs/subsystems_timeline_shared/custom-parameters.ts';
import { timelineParameterEditorContextKey } from '@/utility/timeline-parameter-editor-context.ts';
import GsVisualModuleEditor from './GsVisualModuleEditor.vue';
import GsTimelineEffectSettings from './GsTimeline.EffectSettings.vue';
import GsTimelineVoicevoxSettings from './GsTimeline.VoicevoxSettings.vue';
import GsTimelineVoicevoxSubtitleSettings from './GsTimeline.VoicevoxSubtitleSettings.vue';
import GsTimelineTextSettings from './GsTimeline.TextSettings.vue';
import GsTimelineShapeSettings from './GsTimeline.ShapeSettings.vue';
import GsTimelineTransformSettings from './GsTimeline.TransformSettings.vue';
import GsTimelineCameraSettings from './GsTimeline.CameraSettings.vue';
import type { TimelineMask, TimelineLayerMask } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import type { VisualModuleEdit } from '@/types/visual-module-editor.ts';
import type { ParamEdit } from './GsVisualParam.vue';
import type { TimelineParameterTarget } from '@/utility/timeline-scene.ts';
import type { TimelineLayer, TimelineScene } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineKeyframeSelection } from '@/utility/timeline-selection.ts';
import { i18n } from '@/i18n.ts';
import { appContext } from '@/app.ts';
import { exportVisualModuleFile } from '@/utility/visual-module-file.ts';
import { commitVisualModuleEdit } from '@/utility/visual-module-edit.ts';
import { getLayerParameterValues, resolveLayerParameter } from '@/utility/timeline-scene.ts';
import { createVisualModuleDropActions } from '@/utility/visual-module-drop-actions.ts';

const props = defineProps<{ scene: TimelineScene; layer: TimelineLayer }>();
provide(timelineParameterEditorContextKey, { context: computed(() => getTimelineLayerCustomParameterContext(props.scene.layers, props.layer.id)), isCustomParameterValue: false });
const emit = defineEmits<{ selectKeyframe: [selection: TimelineKeyframeSelection]; expandRequested: [layerId: string]; requestAddInlineEffectNode: [layerId: string]; revealAssets: [] }>();
const { previewPlayback, timelineRendererManagerController } = appContext;
const groupModes = [{ value: 'flat' as const, label: i18n.ts._TimelineLayer.SinglePlane }, { value: 'preserveDepth' as const, label: i18n.ts._TimelineLayer.PreserveDepth }];
const coordinateSpaces = [{ value: 'screen' as const, label: i18n.ts._TimelineLayer.ScreenSpace }, { value: 'world' as const, label: i18n.ts._TimelineLayer.WorldSpace }];
const maskChannels = [{ value: 'alpha' as const, label: i18n.ts._TimelineLayer.Alpha }, { value: 'luminance' as const, label: i18n.ts._TimelineLayer.Luminance }];
const transformTargets = [{ value: 'image' as const, label: i18n.ts._TimelineLayer.TransformImage }, { value: 'region' as const, label: i18n.ts._TimelineLayer.TransformRegion }];
const { stateManager } = appContext.projectContext;
let colorEdit: ReturnType<typeof stateManager.beginEdit<'setTimelineLayerColor'>> | null = null;

function beginColorEdit() {
	colorEdit = stateManager.beginEdit('setTimelineLayerColor');
}

function finishColorEdit() {
	colorEdit?.finish();
	colorEdit = null;
}

function setColor(color: TimelineLayer['color']) {
	const payload = { sceneId: props.scene.id, layerId: props.layer.id, color };
	if (colorEdit?.active === true) colorEdit.update(payload);
	else stateManager.commit('setTimelineLayerColor', payload);
}

onBeforeUnmount(finishColorEdit);
let disposed = false;
onBeforeUnmount(() => { disposed = true; });
const inlineAssetDropActions = computed(() => {
	const layer = props.layer;
	return layer.layerType !== 'inlineVisualModule' ? null : createVisualModuleDropActions({
		context: appContext.projectContext,
		target: { sceneId: props.scene.id, inlineVisualModuleLayerId: layer.id },
		isActive: () => !disposed && props.layer === layer,
		revealAssets: () => emit('revealAssets'),
	});
});
const sceneId = computed(() => props.scene.id);

function changeContainerType(target: TimelineContainerLayerType) {
	if (!isTimelineContainerLayer(props.layer) || target === props.layer.layerType) return;
	stateManager.commit('convertTimelineContainer', { sceneId: props.scene.id, layerId: props.layer.id, target });
}

const sceneLayers = computed(() => flattenTimelineLayers(props.scene.layers));
const imageLayerOptions = computed(() => {
	const visit = (layers: readonly TimelineLayer[], parents: readonly string[]): { value: string; label: string }[] => layers.flatMap(layer => [
		...layer.id !== props.layer.id && isTimelineVisualLayer(layer) ? [{ value: layer.id, label: [...parents, layer.name].join(' / ') }] : [],
		...isTimelineContainerLayer(layer) ? visit(layer.layers, [...parents, layer.name]) : [],
	]);
	return visit(props.scene.layers, []);
});
const anotherLayerAudioOptions = computed(() => sceneLayers.value
	.filter(layer => layer.id !== props.layer.id && isTimelineAudioOutputLayer(layer))
	.map(layer => ({ value: layer.id, label: layer.name })));
const layerMaskSourceOptions = computed(() => {
	const sources = new Set(getTimelineLayerMaskSources(props.scene.layers, props.layer.id).map(layer => layer.id));
	const items: { value: string | null; label: string }[] = [{ value: null, label: i18n.ts.None }, ...imageLayerOptions.value.filter(item => sources.has(item.value))];
	const layer = props.layer;
	const id = isTimelineVisualLayer(layer) ? layer.layerMask?.sourceLayerId : null;
	if (id != null && !sources.has(id)) items.push({ value: id, label: i18n.tsx._Parameter.MissingLayer({ id }) });
	return items;
});
const visualModule = computed(() => {
	const layer = props.layer;
	return layer.layerType === 'inlineVisualModule' ? layer.visualModule
		: layer.layerType === 'visualModule' ? appContext.projectContext.getVisualModuleById(layer.visualModuleId) : null;
});
const inlineEffectStates = computed(() => previewPlayback.state.value.mode === 'timeline'
	? timelineRendererManagerController.getLayerEffectStates(props.scene.id, props.layer.id) : null);
const effectLayerState = computed(() => previewPlayback.state.value.mode === 'timeline' && props.layer.layerType === 'effect'
	? timelineRendererManagerController.getEffectLayerState(props.scene.id, props.layer.id) : null);

const exportingVisualModule = ref(false);

function setMask(mask: TimelineMask | null) {
	stateManager.commit('setTimelineLayerMask', { sceneId: props.scene.id, layerId: props.layer.id, mask });
}

function setLayerMaskSource(sourceLayerId: string | null) {
	const layer = props.layer;
	if (!isTimelineVisualLayer(layer)) return;
	stateManager.commit('setTimelineLayerReferenceMask', {
		sceneId: props.scene.id,
		layerId: layer.id,
		layerMask: sourceLayerId == null ? null : {
			channel: 'alpha',
			inverted: false,
			...layer.layerMask,
			sourceLayerId,
		},
	});
}

function updateLayerMask(change: Partial<TimelineLayerMask>) {
	const layer = props.layer;
	if (isTimelineVisualLayer(layer) && layer.layerMask != null) stateManager.commit('setTimelineLayerReferenceMask', {
		sceneId: props.scene.id,
		layerId: layer.id,
		layerMask: { ...layer.layerMask, ...change },
	});
}

function updateMask(change: Partial<TimelineMask>) {
	const layer = props.layer;
	if (isTimelineVisualLayer(layer) && layer.mask != null) setMask({ ...layer.mask, ...change });
}

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
	if (event.kind === 'node' || event.kind === 'visualModuleCustomParameterReference') return;
	if (event.kind === 'inputSource' && (event.inputSource === 'node' || event.inputSource === 'visualModuleCustomParameterReference')) return;
	const mergeKey = event.mergeKey != null ? JSON.stringify([layer.id, target, event.paramPath, event.mergeKey]) : null;
	if (event.kind === 'anotherLayerAudio' || (event.kind === 'inputSource' && (event.inputSource === 'lowerLayerAudio' || event.inputSource === 'anotherLayerAudio'))) {
		if (target === 'effect' || target === 'module') stateManager.commit('editTimelineLayerParam', {
			sceneId: props.scene.id,
			layerId: layer.id,
			target,
			paramPath: event.paramPath,
			edit: event,
		}, mergeKey);
		return;
	}
	if (event.kind === 'lowerLayerOutput' || event.kind === 'anotherLayerOutput' || (event.kind === 'inputSource' && (event.inputSource === 'lowerLayerOutput' || event.inputSource === 'anotherLayerOutput'))) {
		if (target !== 'effect' && target !== 'module') return;
		stateManager.commit('editTimelineLayerParam', {
			sceneId: props.scene.id,
			layerId: layer.id,
			target,
			paramPath: event.paramPath,
			edit: event,
		}, mergeKey);
		return;
	}
	stateManager.commit('editTimelineLayerParam', {
		sceneId: props.scene.id,
		layerId: layer.id,
		target,
		paramPath: event.paramPath,
		edit: event,
	}, mergeKey);
	if (event.kind === 'keyframesTimelineInline' || (event.kind === 'inputSource' && event.inputSource === 'keyframesTimelineInline')) {
		emit('expandRequested', layer.id);
	}
}
</script>

<style module>
.inlineVisualModuleEditor {
	flex: 1;
	min-height: 0;
}
</style>
