<template>
<div v-if="isVisible" :class="$style.root" :data-test-parameter-path="JSON.stringify(paramPath)">
	<div ref="rowEl" :class="[$style.row, { [$style.containerRow]: isContainer }]" data-wire-input-row @contextmenu.prevent.stop="onRowContextmenu">
		<div :class="[$style.paramHeader, { [$style.isDyamic]: paramValue.inputSource !== 'literal' }]">
			<template v-if="isContainer">
				<button
					class="_button"
					:class="$style.collapseButton"
					data-test-parameter-toggle
					:data-test-parameter-expanded="expanded"
					@pointerdown.stop
					@click.stop="expanded = !expanded"
				>
					<i :class="expanded ? 'ti ti-chevron-down' : 'ti ti-chevron-right'"></i>
				</button>
				<GsNodePort
					v-if="node != null && vectorComponents == null"
					v-show="!expanded && hasConnectedChildren"
					data-test-parameter-collapsed-port
					:dataType="{ kind: 'any' }"
					@update:element="collapsedPortEl = $event"
				/>
			</template>
			<GsNodePort v-else-if="canNode && node != null" :dataType="inputDataType" style="cursor: pointer;" @pointerdown.stop @click.stop="showNodeInputMenu" @update:element="portEl = $event"/>
			<GsNodePort v-else placeholder :data-type="null"/>

			<div :class="$style.paramLabel" data-test-parameter-menu @click="showMenu">
				<GsCondensedLine>{{ label ?? paramDef.ui.label }}</GsCondensedLine>
			</div>
			<div style="height: 100%; place-content: center;">
				<i v-if="paramValue.inputSource === 'envVariable'" v-tooltip="i18n.ts._Parameter.EnvironmentVariable" class="ti ti-variable" :class="$style.typeIcon"></i>
				<i v-else-if="paramValue.inputSource === 'expression'" v-tooltip="i18n.ts._Parameter.Expression" class="ti ti-math-function" :class="$style.typeIcon"></i>
				<i v-else-if="(paramValue.inputSource === 'nodesEffectPublicParameterReference' || paramValue.inputSource === 'timelineLayerPublicParameterReference')" v-tooltip="i18n.ts._Parameter.PublicParameter" class="ti ti-wifi" :class="$style.typeIcon"></i>
				<i v-else-if="paramValue.inputSource === 'nodesEffectCustomParameterValueReference'" v-tooltip="i18n.ts._Parameter.CustomParameter" class="ti ti-remote-control" :class="$style.typeIcon"></i>
				<i v-else-if="paramValue.inputSource === 'node'" v-tooltip="i18n.ts._Parameter.Node" class="ti ti-plug" :class="$style.typeIcon"></i>
				<i v-else-if="paramValue.inputSource === 'anotherLayerOutput'" v-tooltip="i18n.ts._Parameter.AnotherLayerOutput" class="ti ti-stack" :class="$style.typeIcon"></i>
				<i v-else-if="paramValue.inputSource === 'lowerLayerOutput'" v-tooltip="i18n.ts._Parameter.LowerLayerOutput" class="ti ti-stack-2" :class="$style.typeIcon"></i>
				<i v-else-if="paramValue.inputSource === 'previewInputImage'" v-tooltip="i18n.ts._EffectPreview.ImageInput" class="ti ti-photo" :class="$style.typeIcon"></i>
				<i v-else-if="paramValue.inputSource === 'previewInputAudio'" v-tooltip="i18n.ts._EffectPreview.AudioInput" class="ti ti-wave-sine" :class="$style.typeIcon"></i>
				<i v-else-if="paramValue.inputSource === 'lowerLayerAudio'" v-tooltip="i18n.ts._Parameter.LowerLayerAudio" class="ti ti-wave-sine" :class="$style.typeIcon"></i>
				<i v-else-if="paramValue.inputSource === 'anotherLayerAudio'" v-tooltip="i18n.ts._Parameter.AnotherLayerAudio" class="ti ti-wave-sine" :class="$style.typeIcon"></i>
				<i v-else-if="paramValue.inputSource === 'keyframesTimelineInline'" v-tooltip="i18n.ts._Parameter.Keyframes" class="ti ti-timeline" :class="$style.typeIcon"></i>
				<i v-else-if="paramValue.inputSource === 'curveAnimationInline'" v-tooltip="i18n.ts._Parameter.CurveAnimation" class="ti ti-ease-in-out-control-points" :class="$style.typeIcon"></i>
				<i v-else-if="vectorComponents != null" v-tooltip="i18n.ts._Parameter.Decompose" class="ti ti-arrows-split-2" :class="$style.typeIcon"></i>
			</div>
		</div>
		<div :class="$style.paramBody">
			<template v-if="paramDef.dataType.kind === 'array'">
				<span :class="$style.count">{{ arrayValues.length }}<template v-if="arrayMaxElements != null"> / {{ arrayMaxElements }}</template></span>
				<GsButton v-tooltip="i18n.ts._Parameter.AddElement" iconOnly icon="ti ti-plus" :disabled="!canAddArrayElement" @click="addElement"/>
			</template>
			<template v-else-if="paramDef.dataType.kind !== 'struct' && vectorComponents == null">
				<i v-if="hasNodeInputTypeMismatch(nodes, nodeConnection, inputDataType, paramDefs, effectDefinitions) || ((paramValue.inputSource === 'lowerLayerOutput' || paramValue.inputSource === 'anotherLayerOutput') && !imageInputTypeCompatible)" v-tooltip="i18n.ts._Node.TypeMismatch" class="ti ti-alert-triangle" :class="$style.typeWarning"></i>
				<div :class="$style.control">
					<GsTextarea v-if="paramValue.inputSource === 'expression'" :key="paramPathKey(paramPath)" adaptiveHeight data-test-base-expression-code manualSave class="_monospace" :modelValue="paramValue.expression" @update:modelValue="updateParamAsExpression">
						<template #caption="{ value }">
							<div v-if="hasExpressionSyntaxError(value ?? '')" data-test-base-expression-error style="color: var(--THEME-error);"><i class="ti ti-alert-triangle"></i> {{ (value ?? '').trim() === '' ? i18n.ts._Parameter.EmptyExpression : i18n.ts._Parameter.SyntaxError }}</div>
						</template>
					</GsTextarea>
					<GsSelect
						v-else-if="paramValue.inputSource === 'envVariable'"
						:modelValue="paramValue.variable"
						:items="[{ label: i18n.ts.None, value: '' }, ...envVariableItems]"
						@update:modelValue="value => emit('edit', { kind: 'envVariable', ...target(), value })"
					/>
					<div v-else-if="paramValue.inputSource === 'curveAnimationInline'" style="display: grid; gap: 6px;">
						<GsButton @click="selectFunctionCurve">{{ functionCurveLabel }}</GsButton>
						<GsButton
							v-if="inlineFunctionCurve != null"
							data-test-edit-inline-function-curve
							@click="inlineFunctionCurveEditorOpen = true"
						>
							{{ i18n.ts._FunctionCurve.Edit }}
						</GsButton>
						<GsButton v-if="selectedProjectFunctionCurve != null" @click="projectFunctionCurveEditorOpen = true">{{ i18n.ts._FunctionCurve.Edit }}</GsButton>
						<GsSelect
							v-if="inlineFunctionCurve?.type === 'bezier'"
							:modelValue="inlineFunctionCurve.isXNormalized ? 'normalized' : 'milliseconds'"
							:items="curveAnimationTimeAxisItems"
							@update:modelValue="value => updateInlineCurveAnimationNormalization('x', value === 'normalized')"
						>
							<template #label>{{ i18n.ts._Parameter.TimeAxis }}</template>
						</GsSelect>
						<GsSelect
							v-if="inlineFunctionCurve?.type === 'bezier'"
							:modelValue="inlineFunctionCurve.isYNormalized ? 'normalized' : 'raw'"
							:items="curveAnimationValueAxisItems"
							@update:modelValue="value => updateInlineCurveAnimationNormalization('y', value === 'normalized')"
						>
							<template #label>{{ i18n.ts._FunctionCurve.YAxis }}</template>
						</GsSelect>
						<GsInput
							v-if="activeFunctionCurve != null && isFunctionCurveXNormalized(activeFunctionCurve)"
							type="number"
							manualSave
							:min="1"
							:modelValue="paramValue.curveAnimation.trimmedDurationMs ?? 1000"
							@update:modelValue="updateCurveAnimationDuration"
						>
							<template #label>{{ i18n.ts._Parameter.DurationMs }}</template>
						</GsInput>
						<template v-if="activeFunctionCurve != null && isFunctionCurveYNormalized(activeFunctionCurve)">
							<GsInput
								type="number"
								manualSave
								validateNumberBounds
								:modelValue="paramValue.curveAnimation.yRangeMin ?? DEFAULT_CURVE_ANIMATION_Y_RANGE_MIN"
								:max="paramValue.curveAnimation.yRangeMax ?? DEFAULT_CURVE_ANIMATION_Y_RANGE_MAX"
								@update:modelValue="yRangeMin => updateCurveAnimationOptions({ yRangeMin })"
							>
								<template #label>{{ i18n.ts._FunctionCurve.YAtZero }}</template>
							</GsInput>
							<GsInput
								type="number"
								manualSave
								validateNumberBounds
								:modelValue="paramValue.curveAnimation.yRangeMax ?? DEFAULT_CURVE_ANIMATION_Y_RANGE_MAX"
								:min="paramValue.curveAnimation.yRangeMin ?? DEFAULT_CURVE_ANIMATION_Y_RANGE_MIN"
								@update:modelValue="yRangeMax => updateCurveAnimationOptions({ yRangeMax })"
							>
								<template #label>{{ i18n.ts._FunctionCurve.YAtOne }}</template>
							</GsInput>
						</template>
						<GsSelect
							:modelValue="paramValue.curveAnimation.wrapMode"
							:items="curveAnimationWrapModeItems"
							@update:modelValue="wrapMode => updateCurveAnimationOptions({ wrapMode })"
						>
							<template #label>{{ i18n.ts._Parameter.WrapMode }}</template>
						</GsSelect>
						<GsSelect
							v-if="curveAnimationEndEnabled !== false"
							:modelValue="paramValue.curveAnimation.offsetMode"
							:items="curveAnimationOffsetModeItems"
							@update:modelValue="offsetMode => updateCurveAnimationOptions({ offsetMode })"
						>
							<template #label>{{ i18n.ts._Parameter.Offset }}</template>
						</GsSelect>
					</div>
					<div v-else-if="paramValue.inputSource === 'keyframesTimelineInline'" style="display: grid; gap: 6px;">
						<GsInlineKeyframesEditor
							v-if="vectorComponent && timelineEditor == null"
							:definition="paramDef"
							:binding="paramValue"
							@update="(value, mergeKey) => emit('edit', { kind: 'keyframesTimelineInline', ...target(), value, mergeKey })"
						/>
						<template v-else>{{ paramValue.keyframesTimeline.keyframes.length }} {{ i18n.ts._Parameter.InlineKeyframes }}</template>
					</div>
					<GsSelect v-else-if="paramValue.inputSource === 'timelineLayerPublicParameterReference'" data-test-timeline-public-parameter-reference :modelValue="timelinePublicParameterKey" :items="timelinePublicParameterItems" @update:modelValue="updateTimelinePublicParameterReference"/>
					<GsSelect
						v-else-if="paramValue.inputSource === 'nodesEffectPublicParameterReference'"
						data-test-nodes-effect-public-parameter-reference
						:modelValue="paramValue.parameterId"
						:items="[{ label: i18n.ts.None, value: '' }, ...nodesEffectPublicParameterReferenceItems]"
						@update:modelValue="value => emit('edit', { kind: 'nodesEffectPublicParameterReference', ...target(), value })"
					/>
					<GsSelect
						v-else-if="paramValue.inputSource === 'nodesEffectCustomParameterValueReference'"
						data-test-nodes-effect-custom-parameter-reference
						:modelValue="paramValue.parameterId"
						:items="[{ label: i18n.ts.None, value: '' }, ...nodesEffectCustomParameterValueReferenceItems]"
						@update:modelValue="value => emit('edit', { kind: 'nodesEffectCustomParameterValueReference', ...target(), value })"
					/>
					<div v-else-if="paramValue.inputSource === 'node'" style="display: flex; gap: 4px;">
						<GsSelect
							style="flex: 1; min-width: 0;"
							:modelValue="nodeOutputKey(nodeConnection)"
							:items="[{ label: i18n.ts.None, value: null }, ...nodeOutputItems]"
							@update:modelValue="updateParamAsNode"
						/>
						<button class="_button" style="padding: 2px; flex-shrink: 0;" @click="showNodeInputMenu"><i class="ti ti-dots"></i></button>
					</div>
					<div v-else-if="paramValue.inputSource === 'lowerLayerOutput'" style="display: flex; gap: 4px; align-items: center;">
						<span style="flex: 1; min-width: 0;">{{ i18n.ts._Parameter.LowerLayerOutput }}</span>
						<button v-if="imageInputSamplingEnabled" class="_button" style="padding: 2px; flex-shrink: 0;" @click="showLowerLayerOutputSamplingMenu"><i class="ti ti-dots"></i></button>
					</div>
					<div v-else-if="paramValue.inputSource === 'anotherLayerOutput'" style="display: flex; gap: 4px; align-items: center;">
						<GsSelect data-test-image-layer-reference :modelValue="paramValue.layerId" :items="imageLayerItems" @update:modelValue="value => updateAnotherLayerOutput({ layerId: value })"/>
						<GsSelect data-test-layer-output-stage :modelValue="paramValue.outputStage" :items="outputStageItems" @update:modelValue="value => updateAnotherLayerOutput({ outputStage: value })"/>
						<button v-if="imageInputSamplingEnabled" class="_button" :v-tooltip="i18n.ts._Parameter.Sampling" @click="showAnotherLayerOutputSamplingMenu"><i class="ti ti-dots"></i></button>
					</div>
					<span v-else-if="paramValue.inputSource === 'previewInputImage'" data-test-preview-image-param>{{ i18n.ts._EffectPreview.ImageInput }}</span>
					<span v-else-if="paramValue.inputSource === 'previewInputAudio'" data-test-preview-audio-param>{{ i18n.ts._EffectPreview.AudioInput }}</span>
					<span v-else-if="previewMediaInputEnabled && paramDef.dataType.kind === 'any' && paramValue.inputSource === 'literal'">{{ i18n.ts._TimelineLayer.EditingUnsupported }}</span>
					<span v-else-if="paramValue.inputSource === 'lowerLayerAudio'">{{ i18n.ts._Parameter.LowerLayerAudio }}</span>
					<GsSelect v-else-if="paramValue.inputSource === 'anotherLayerAudio'" :modelValue="paramValue.layerId" :items="anotherLayerAudioItems" @update:modelValue="updateAnotherLayerAudio"/>
					<GsSelect v-else-if="paramValue.inputSource === 'literal' && paramDef.dataType.kind === 'audioSource' && anotherLayerAudioOptions != null" :modelValue="null" :items="[{ label: i18n.ts.None, value: null }]" @update:modelValue="updateParamAsLiteral(null)"/>
					<GsLiteralLeafValueControl
						v-else-if="paramValue.inputSource === 'literal'"
						ref="controlComponent"
						data-test-parameter-value-control
						:dataType="paramDef.dataType"
						:control="paramDef.ui.control"
						:title="label ?? paramDef.ui.label"
						:value="paramValue.value"
						:vectorNavigationSpan="vectorNavigationSpan"
						@input="updateParamAsLiteral"
						@changeContinuous="updateParamAsLiteral"
						@reset="onReset"
					/>
				</div>
			</template>
			<GsButton
				v-if="(vectorComponents == null && isParameterType(paramDef, 'vector') && paramDef.ui.control.controlType === 'xy') || isViewport2DParameter(paramDef)"
				data-test-preview-parameter-toggle
				:data-test-preview-viewport-toggle="isViewport2DParameter(paramDef) ? '' : null"
				iconOnly
				icon="ti ti-pointer"
				:primary="previewParameterHandle.enabled.value"
				:disabled="!previewParameterHandle.available.value"
				@click="previewParameterHandle.toggle"
			/>
			<GsButton v-if="vectorComponents != null" v-tooltip="i18n.ts._Parameter.CombineComponents" iconOnly danger icon="ti ti-arrows-join-2" @click="combineComponents()"/>
			<slot name="actions"></slot>
		</div>
	</div>
	<div v-if="expressionModifier != null" :class="$style.expressionModifier" data-test-expression-modifier>
		<div :class="$style.modifierHeader">
			<label style="display: flex; align-items: center; gap: 6px;">
				<input data-test-expression-modifier-enabled type="checkbox" :checked="expressionModifier.enabled" @change="updateExpressionModifier({ enabled: ($event.target as HTMLInputElement).checked })">
				{{ i18n.ts._Parameter.ExpressionModifier }}
			</label>
			<GsButton v-tooltip="i18n.ts._Parameter.RemoveExpressionModifier" data-test-expression-modifier-remove iconOnly icon="ti ti-x" @click="removeExpressionModifier"/>
		</div>
		<GsTextarea :key="paramPathKey(paramPath)" adaptiveHeight data-test-expression-modifier-code manualSave class="_monospace" :modelValue="expressionModifier.code" @update:modelValue="code => updateExpressionModifier({ code })">
			<template #caption="{ value }">
				<span v-if="expressionModifier.enabled && hasExpressionSyntaxError(value ?? '')" data-test-expression-modifier-error style="color: var(--THEME-error);">{{ (value ?? '').trim() === '' ? i18n.ts._Parameter.EmptyExpression : i18n.ts._Parameter.SyntaxError }}</span>
			</template>
		</GsTextarea>
	</div>
	<Teleport to="body">
		<GsFunctionCurveEditorWindow
			v-if="projectFunctionCurveEditorOpen && selectedProjectFunctionCurve != null"
			:functionCurve="selectedProjectFunctionCurve"
			:title="i18n.ts._FunctionCurve.ProjectFunctionCurves + ': ' + selectedProjectFunctionCurve.nameForReference"
			@change="updateProjectFunctionCurve"
			@closed="projectFunctionCurveEditorOpen = false"
		/>
		<GsFunctionCurveEditorWindow
			v-if="inlineFunctionCurveEditorOpen && inlineFunctionCurve != null"
			data-test-inline-function-curve-editor
			:functionCurve="inlineFunctionCurve"
			:title="label ?? paramDef.ui.label"
			@change="updateInlineFunctionCurve"
			@closed="inlineFunctionCurveEditorOpen = false"
		/>
	</Teleport>
	<!-- 非表示でも子を保持し、入力途中の内容・子の開閉・プレビューハンドルを失わせない。 -->
	<div v-if="isParameterType(paramDef, 'array')" v-show="expanded" :class="$style.children" data-test-parameter-children>
		<GsVisualParam
			v-for="(element, index) in arrayValues"
			:key="element.id"
			:functionCurves="functionCurves"
			:projectFunctionCurves="projectFunctionCurves"
			:availableVariables="availableVariables"
			:curveAnimationEndEnabled="curveAnimationEndEnabled"
			:previewParameterGroup="previewParameterGroup"
			:keyframesEnabled="keyframesEnabled"
			:imageInputEnabled="imageInputEnabled"
			:imageLayerOptions="imageLayerOptions"
			:imageInputSamplingEnabled="imageInputSamplingEnabled"
			:anotherLayerAudioOptions="anotherLayerAudioOptions"
			:nodesEffect="nodesEffect"
			:node="node"
			:paramPath="[...paramPath, element.id]"
			:paramDef="getArrayElementDefinition(paramDef)"
			:paramValue="element.binding"
			:defaultBinding="arrayDefaultValues?.[index]?.binding"
			:label="'[' + index + ']'"
			@edit="emit('edit', $event)"
		>
			<template #actions>
				<GsButton v-tooltip="i18n.ts._Parameter.RemoveElement" iconOnly danger icon="ti ti-x" @click="removeElement(element.id)"/>
			</template>
		</GsVisualParam>
	</div>
	<div v-else-if="paramDef.dataType.kind === 'struct' && structValues" v-show="expanded" :class="$style.children" data-test-parameter-children>
		<GsVisualParam
			v-for="[key, def] in visibleFields"
			:key="key"
			:functionCurves="functionCurves"
			:projectFunctionCurves="projectFunctionCurves"
			:availableVariables="availableVariables"
			:curveAnimationEndEnabled="curveAnimationEndEnabled"
			:previewParameterGroup="previewParameterGroup"
			:keyframesEnabled="keyframesEnabled"
			:imageInputEnabled="imageInputEnabled"
			:imageLayerOptions="imageLayerOptions"
			:imageInputSamplingEnabled="imageInputSamplingEnabled"
			:anotherLayerAudioOptions="anotherLayerAudioOptions"
			:nodesEffect="nodesEffect"
			:node="node"
			:paramPath="[...paramPath, key]"
			:paramDef="def"
			:vectorNavigationSpan="key === 'center' ? previewParameterHandle.viewportNavigationSpan.value : null"
			:paramValue="structValues[key]"
			:defaultBinding="structDefaultValues?.[key]"
			@edit="emit('edit', $event)"
		/>
	</div>
	<div v-else-if="vectorComponents != null" v-show="expanded" :class="$style.children" data-test-parameter-children>
		<GsVisualParam
			v-for="{ index, definition, binding } in vectorComponents"
			:key="index"
			vectorComponent
			:functionCurves="functionCurves"
			:projectFunctionCurves="projectFunctionCurves"
			:availableVariables="availableVariables"
			:curveAnimationEndEnabled="curveAnimationEndEnabled"
			:keyframesEnabled="keyframesEnabled || node != null"
			:paramPath="[...paramPath, String(index)]"
			:paramDef="definition"
			:paramValue="binding"
			:label="'[' + index + ']'"
			@edit="emit('edit', $event)"
		/>
	</div>
</div>
</template>

<script lang="ts">
import { createDefaultParameterBinding } from '@gs/shared/parameter/parameter-default.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.js';
import GsTextarea from './common/GsTextarea.vue';
import GsNodePort from './GsNodePort.vue';
import GsLiteralLeafValueControl from './GsLiteralLeafValueControl.vue';
import GsButton from './common/GsButton.vue';
import GsInput from './common/GsInput.vue';
import GsCondensedLine from './common/GsCondensedLine.vue';
import GsSelect from './common/GsSelect.vue';
import GsFunctionCurveEditorWindow from './GsFunctionCurveEditorWindow.vue';
import GsInlineKeyframesEditor from './GsInlineKeyframesEditor.vue';
import type { TimelineLowerLayerOutputBinding, TimelineAnotherLayerOutputBinding, TimelineLayerOutputStage } from '@gs/subsystems_timeline_shared/parameter-binding.ts';
import type { ParameterArrayElement } from '@gs/shared/parameter/parameter-binding.ts';

export type AnotherLayerAudioOption = { value: string; label: string };

export type ParamEdit = { paramPath: ParamPath; mergeKey?: string | null } & (
	| ValueParameterEdit
	| { kind: 'copy' }
	| { kind: 'paste' }
	| { kind: 'node'; value: NodeOutputReference | null; preserveSampling: boolean }
	| { kind: 'lowerLayerOutput'; value: TimelineLowerLayerOutputBinding }
	| { kind: 'anotherLayerOutput'; value: Extract<EditableParameterBinding, { inputSource: 'anotherLayerOutput' }> }
	| { kind: 'anotherLayerAudio'; value: string | null }
	| { kind: 'timelineLayerPublicParameterReference'; value: TimelineLayerPublicParameterReferenceBinding }
	| { kind: 'nodesEffectPublicParameterReference'; value: string }
	| { kind: 'nodesEffectCustomParameterValueReference'; value: string }
	| { kind: 'createPublicParameter' }
	| { kind: 'createCustomParameter' }
	| ParameterInputSourceEdit<'timelineLayerPublicParameterReference' | 'node' | 'anotherLayerOutput' | 'lowerLayerOutput' | 'lowerLayerAudio' | 'anotherLayerAudio' | 'nodesEffectPublicParameterReference' | 'nodesEffectCustomParameterValueReference' | 'previewInputImage' | 'previewInputAudio'>
);
</script>

<script lang="ts" setup>
import type { ParameterExpressionModifier } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { Ref } from 'vue';
import type { NodeOutputReference, NodesEffect, NodesEffectEffectNode } from '@/types/nodes-effect-view.ts';
import type { ExpressionVariableName } from '@gs/shared/expression/expression-environment.ts';
import type { ParamPath } from '@/utility/node-params.ts';
import { DEFAULT_CURVE_ANIMATION_Y_RANGE_MIN, DEFAULT_CURVE_ANIMATION_Y_RANGE_MAX, isValidCurveAnimationYRange } from '@gs/shared/curve-animation/curve-animation.ts';
import type { CurveAnimation } from '@gs/shared/curve-animation/curve-animation.ts';
import { isFunctionCurveXNormalized, isFunctionCurveYNormalized } from '@gs/shared/function-curve/function-curve.ts';
import type { FunctionCurve, SharedFunctionCurve } from '@gs/shared/function-curve/function-curve.ts';
import type { EditableParameterBinding, ParameterInputSourceEdit, ValueParameterEdit } from '@/types/parameter-edit.ts';
import type { MenuItem } from '@/types/menu.ts';
import type { TimelineLayerPublicParameterReferenceBinding } from '@gs/subsystems_timeline_shared/parameter-binding.ts';
import type { TimelineParameterTarget } from '@gs/subsystems_timeline_shared/types.ts';
import { getEffectDefinitions } from '@/utility/project-effects.ts';
import { getArrayElementDefinition, getStructFieldDefinitions, getVectorComponentDefinition, isParameterType } from '@gs/shared/parameter/parameter-definition.ts';
import { isKeyframesDataType } from '@gs/shared/keyframes/keyframes-timeline.ts';
import { canUseEffectLivePreviewInput, isEffectLivePreviewMediaBinding } from '@gs/glitch-studio_shared/effect-live-preview-input.ts';
import { isValueParameterBinding } from '@gs/shared/parameter/parameter-binding.ts';
import { supportsParameterExpressionModifier } from '@gs/shared/parameter/parameter-expression-modifier.ts';
import { isParameterVisible } from '@/utility/parameter-visibility.ts';
import { NODES_EFFECT_CUSTOM_PARAMETER_TYPES } from '@/utility/nodes-effect-view-parameters.ts';
import { computed, inject, onBeforeUnmount, ref, shallowRef, useTemplateRef, watch, watchEffect } from 'vue';
import { getNodeInputDataType, areNodeDataTypesCompatible } from '@gs/shared/data-type/node-compatibility.ts';
import { areDataTypesEqual } from '@gs/shared/data-type/data-type.ts';
import * as AiScript from '@syuilo/aiscript';
import { i18n } from '@/i18n.ts';
import { connectedNodeParameterPathKeysKey, useNodesEffectWires } from '@/utility/nodes-effect-wires.ts';
import { timelineParameterEditorContextKey } from '@/utility/timeline-parameter-editor-context.ts';
import { getTimelineLayerPublicParameterSources, areTimelinePublicParameterTypesCompatible } from '@gs/subsystems_timeline_shared/public-parameters.ts';
import { paramPathKey } from '@/utility/node-params.ts';
import { getNodeOutputItems, hasNodeInputTypeMismatch, nodeOutputKey, canConnectNodeDataTypes } from '@/utility/node-outputs.ts';
import { registerWireInput } from '@/utility/wire-drag.ts';
import { getNodeInputSamplingMenuItems } from '@/utility/input-sampling-menu.ts';
import * as ui from '@/ui.ts';
import { useProjectSession } from '@/project-session.ts';
import { preferences } from '@/preferences.ts';
import { getAvailableFunctionCurves } from '@gs/glitch-studio_shared/project/function-curves.ts';
import { createInlineCurveAnimation, duplicateFunctionCurve, setInlineCurveAnimationXNormalized, setInlineCurveAnimationYNormalized } from '@/utility/curve-animation.ts';
import { usePreviewParameterHandle } from '@/composables/usePreviewParameterHandle.ts';
import { isViewport2DParameter } from '@/utility/preview-viewport.ts';
import { canCreateNamedParameterFromBinding } from '@/utility/named-parameter-creation.ts';
import { useParameterExpansion } from '@/composables/useParameterExpansion.ts';
import { clipboardText } from '@/utility/clipboard-text.ts';

const projectSession = useProjectSession();

const effectDefinitions = computed(() => getEffectDefinitions(projectSession.projectContext.stateManager.state));

const wireMap = useNodesEffectWires();
const connectedParameterPathKeys = inject(connectedNodeParameterPathKeysKey, null);
const timelineEditor = inject(timelineParameterEditorContextKey, null);

const props = defineProps<{
	functionCurves: readonly SharedFunctionCurve[];
	projectFunctionCurves?: readonly SharedFunctionCurve[];
	availableVariables: readonly ExpressionVariableName[];
	nodesEffect?: NodesEffect;
	/** ノードを持たないカスタム値エディタで、内部の参照だけを有効にする。 */
	nodesEffectParameterReferencesEnabled?: boolean;
	node?: NodesEffectEffectNode;
	paramPath: ParamPath;
	paramDef: ParameterDefinition;
	paramValue: EditableParameterBinding;
	/** 利用場所や親コンテナの既定Binding。省略時はパラメータ定義の既定値を使う。 */
	defaultBinding?: EditableParameterBinding;
	label?: string;
	keyframesEnabled?: boolean;
	vectorComponent?: boolean;
	previewMediaInputEnabled?: boolean;
	imageInputEnabled?: boolean;
	imageInputSamplingEnabled?: boolean;
	imageLayerOptions?: readonly { value: string; label: string }[];
	/** 指定された場合、Timelineの音声入力を有効にする。候補は呼び出し元Sceneが所有する。 */
	anotherLayerAudioOptions?: readonly AnotherLayerAudioOption[];
	curveAnimationEndEnabled?: boolean;
	previewParameterGroup?: TimelineParameterTarget;
	/** 親の表示範囲から換算した、中心座標の相対操作に使う長辺の長さ。 */
	vectorNavigationSpan?: number | null;
}>();

const emit = defineEmits<{ edit: [event: ParamEdit] }>();
const previewParameterHandle = usePreviewParameterHandle(projectSession, props);
const expanded = useParameterExpansion(projectSession, props);
const vectorComponents = computed(() => {
	const { paramDef, paramValue } = props;
	if (paramValue.inputSource !== 'components' || !isParameterType(paramDef, 'vector')) return null;
	return ([0, 1] as const).map(index => ({
		index,
		definition: getVectorComponentDefinition(paramDef, index, paramDef.defaultValue[index]),
		binding: paramValue.components[index],
	}));
});
const isContainer = computed(() => props.paramDef.dataType.kind === 'struct' || props.paramDef.dataType.kind === 'array' || vectorComponents.value != null);
const hasConnectedChildren = computed(() => connectedParameterPathKeys?.value.has(paramPathKey(props.paramPath)) === true);

const timelinePublicParameterItems = computed(() => {
	const context = timelineEditor?.context.value;
	const items: { value: string | null; label: string }[] = [{ value: null, label: i18n.ts.None }];
	if (context != null && props.node == null && props.nodesEffectParameterReferencesEnabled !== true) {
		for (const owner of getTimelineLayerPublicParameterSources(context, timelineEditor!.isPublicParameterValue)) {
			for (const definition of owner.publicParameterDefs ?? []) {
				if (areTimelinePublicParameterTypesCompatible(props.paramDef, definition)) items.push({ value: JSON.stringify([owner.id, definition.id]), label: `${owner.name} / ${definition.ui.label} (${definition.nameForReference})` });
			}
		}
	}
	const key = timelinePublicParameterKey.value;
	if (key != null && !items.some(item => item.value === key)) items.push({ value: key, label: i18n.ts._Parameter.UnavailablePublicParameter });
	return items;
});
const timelinePublicParameterKey = computed(() => props.paramValue.inputSource === 'timelineLayerPublicParameterReference' && props.paramValue.layerId != null && props.paramValue.parameterId != null ? JSON.stringify([props.paramValue.layerId, props.paramValue.parameterId]) : null);

function updateTimelinePublicParameterReference(key: string | null) {
	const [layerId, parameterId] = key == null ? [null, null] : JSON.parse(key);
	emit('edit', { kind: 'timelineLayerPublicParameterReference', ...target(), value: { inputSource: 'timelineLayerPublicParameterReference', layerId, parameterId } });
}

const rowEl = useTemplateRef('rowEl');
const portEl = shallowRef<HTMLElement | null>(null);
const collapsedPortEl = shallowRef<HTMLElement | null>(null);
const defaultBinding = computed(() => props.defaultBinding ?? createDefaultParameterBinding(props.paramDef));
const isVisible = computed(() => isParameterVisible(props.paramDef, props.paramValue, defaultBinding.value, preferences.r.showAdvancedParameters.value));
const arrayDefaultValues = computed<ParameterArrayElement<EditableParameterBinding>[] | null>(() => props.paramDef.dataType.kind === 'array' && defaultBinding.value.inputSource === 'literal' ? defaultBinding.value.value : null);
const structDefaultValues = computed<Record<string, EditableParameterBinding> | null>(() => props.paramDef.dataType.kind === 'struct' && defaultBinding.value.inputSource === 'literal' ? defaultBinding.value.value : null);
const arrayValues = computed<ParameterArrayElement<EditableParameterBinding>[]>(() => props.paramDef.dataType.kind === 'array' && props.paramValue.inputSource === 'literal' ? props.paramValue.value : []);
const arrayMaxElements = computed(() => isParameterType(props.paramDef, 'array') ? props.paramDef.maxElements ?? null : null);
const canAddArrayElement = computed(() => arrayMaxElements.value == null || arrayValues.value.length < arrayMaxElements.value);
const structValues = computed<Record<string, EditableParameterBinding> | null>(() => props.paramDef.dataType.kind === 'struct' && props.paramValue.inputSource === 'literal' ? props.paramValue.value : null);
const visibleFields = computed(() => {
	if (!isParameterType(props.paramDef, 'struct')) return [];
	const fields: Record<string, ParameterDefinition> = getStructFieldDefinitions(props.paramDef);
	const span = previewParameterHandle.viewportNavigationSpan.value;
	if (isViewport2DParameter(props.paramDef) && span != null && isParameterType(fields.center, 'vector')) {
		const center = fields.center;
		// 刻みは保存値の量子化ではなく増減操作の感度。絶対座標の精度は維持する。
		fields.center = {
			...center,
			ui: {
				...center.ui,
				control: {
					...center.ui.control,
					step: (center.ui.control.step ?? props.paramDef.ui.control.spanAtZoomOne / 1000) * span / props.paramDef.ui.control.spanAtZoomOne,
				},
			},
		};
	}
	return Object.entries(fields);
});
const canNode = computed(() => vectorComponents.value == null && props.paramDef.canNode);
const inputDataType = computed(() => getNodeInputDataType(props.paramDef));
const imageInputTypeCompatible = computed(() => areNodeDataTypesCompatible({ kind: 'color' }, inputDataType.value));
const lowerLayerOutputConnection = computed<TimelineLowerLayerOutputBinding | null>(() => props.paramValue.inputSource === 'lowerLayerOutput' ? props.paramValue as TimelineLowerLayerOutputBinding : null);
const anotherLayerOutputConnection = computed(() => props.paramValue.inputSource === 'anotherLayerOutput' ? props.paramValue : null);
const outputStageItems: { value: TimelineLayerOutputStage; label: string }[] = [
	{ value: 'source', label: i18n.ts._Parameter.LayerSourceOutput },
	{ value: 'rendered', label: i18n.ts._Parameter.LayerRenderedOutput },
	{ value: 'composited', label: i18n.ts._Parameter.LayerCompositedOutput },
];
const imageLayerItems = computed(() => {
	const items: { value: string | null; label: string }[] = [{ value: null, label: i18n.ts.None }, ...props.imageLayerOptions ?? []];
	const id = props.paramValue.inputSource === 'anotherLayerOutput' ? props.paramValue.layerId : null;
	if (id != null && !items.some(item => item.value === id)) items.push({ value: id, label: i18n.tsx._Parameter.MissingLayer({ id }) });
	return items;
});

function updateAnotherLayerOutput(changes: Partial<TimelineAnotherLayerOutputBinding>) {
	if (props.paramValue.inputSource !== 'anotherLayerOutput') return;
	emit('edit', { kind: 'anotherLayerOutput', ...target(), value: { ...props.paramValue, ...changes } });
}

const anotherLayerAudioItems = computed(() => {
	const items: { value: string | null; label: string }[] = [{ value: null, label: i18n.ts.None }, ...props.anotherLayerAudioOptions ?? []];
	const id = props.paramValue.inputSource === 'anotherLayerAudio' ? props.paramValue.layerId : null;
	if (id != null && !items.some(item => item.value === id)) items.push({ value: id, label: i18n.tsx._Parameter.MissingLayer({ id }) });
	return items;
});

function updateAnotherLayerAudio(value: string | null) {
	if (props.paramValue.inputSource === 'anotherLayerAudio' && props.paramValue.layerId !== value) emit('edit', { kind: 'anotherLayerAudio', ...target(), value });
}

const paramDefs = computed(() => props.nodesEffect?.paramDefs ?? []);
const nodes = computed(() => props.nodesEffect?.nodes ?? []);

const availableFunctionCurves = computed(() => getAvailableFunctionCurves(props.functionCurves, props.projectFunctionCurves ?? []));
const curveBinding = computed(() => props.paramValue.inputSource === 'curveAnimationInline' ? props.paramValue.curveAnimation.curveBinding : null);
const inlineFunctionCurve = computed(() => curveBinding.value?.source === 'inline' ? curveBinding.value.curve : null);
const selectedSharedFunctionCurve = computed(() => {
	const binding = curveBinding.value;
	return binding?.source === 'reference' ? availableFunctionCurves.value.find(functionCurve => functionCurve.id === binding.curveId) ?? null : null;
});
const activeFunctionCurve = computed(() => inlineFunctionCurve.value ?? selectedSharedFunctionCurve.value);
const selectedProjectFunctionCurve = computed(() => {
	const selected = selectedSharedFunctionCurve.value;
	return selected != null && !props.functionCurves.some(functionCurve => functionCurve.id === selected.id) ? selected : null;
});
const functionCurveLabel = computed(() => {
	const binding = curveBinding.value;
	if (binding?.source === 'inline') return i18n.ts._FunctionCurve.InlineFunctionCurve;
	if (binding?.curveId == null) return i18n.ts.None;
	return selectedSharedFunctionCurve.value?.nameForReference ?? i18n.ts._FunctionCurve.MissingFunctionCurve;
});
const projectFunctionCurveEditorOpen = ref(false);
const curveAnimationTimeAxisItems = [
	{ label: i18n.ts._Parameter.NormalizedTime, value: 'normalized' },
	{ label: i18n.ts._Parameter.Milliseconds, value: 'milliseconds' },
];
const curveAnimationValueAxisItems = [
	{ label: i18n.ts._FunctionCurve.Normalized, value: 'normalized' },
	{ label: i18n.ts._FunctionCurve.Raw, value: 'raw' },
];
const curveAnimationWrapModeItems = [
	{ label: i18n.ts._WrapModes.clamp, value: 'clamp' },
	{ label: i18n.ts._WrapModes.repeat, value: 'repeat' },
	{ label: i18n.ts._WrapModes.repeatMirrored, value: 'repeatMirrored' },
] satisfies { label: string; value: CurveAnimation['wrapMode'] }[];
const curveAnimationOffsetModeItems = [
	{ label: i18n.ts.Start, value: 'start' },
	{ label: i18n.ts.End, value: 'end' },
] satisfies { label: string; value: CurveAnimation['offsetMode'] }[];
const envVariableItems = computed(() => props.availableVariables.map(variable => {
	const label = Object.hasOwn(i18n.ts._EnvVariables, variable)
		? `${i18n.ts._EnvVariables[variable as keyof typeof i18n.ts._EnvVariables]} (${variable})`
		: variable;
	return { label, value: variable };
}));
const nodesEffectPublicParameterReferenceItems = computed(() => {
	const items = (props.node == null && props.nodesEffectParameterReferencesEnabled !== true ? [] : paramDefs.value)
		.filter(def => !def.canNode && (def.dataType.kind === 'audioSource') === (props.paramDef.dataType.kind === 'audioSource'))
		.filter(def => def.dataType.kind !== 'colorRamp' && props.paramDef.dataType.kind !== 'colorRamp' || areDataTypesEqual(def.dataType, props.paramDef.dataType))
		.filter(def => props.nodesEffectParameterReferencesEnabled !== true || areDataTypesEqual(def.dataType, props.paramDef.dataType))
		.map(def => ({ label: `${def.ui.label} (${def.nameForReference})`, value: def.id }));
	const id = props.paramValue.inputSource === 'nodesEffectPublicParameterReference' ? props.paramValue.parameterId : null;
	if (id != null && id !== '' && !items.some(item => item.value === id)) items.push({ label: i18n.ts._Parameter.UnavailablePublicParameter, value: id });
	return items;
});
const nodesEffectCustomParameterValueReferenceItems = computed(() => {
	const items = (props.nodesEffect == null ? [] : props.nodesEffect.customParameterDefs).filter(definition => areDataTypesEqual(definition.dataType, props.paramDef.dataType))
		.map(definition => ({ label: `${definition.ui.label} (${definition.nameForReference})`, value: definition.id }));
	const id = props.paramValue.inputSource === 'nodesEffectCustomParameterValueReference' ? props.paramValue.parameterId : null;
	if (id != null && id !== '' && !items.some(item => item.value === id)) items.push({ label: i18n.ts._Parameter.UnavailablePublicParameter, value: id });
	return items;
});
const nodeConnection = computed<NodeOutputReference | null>(() => props.paramValue.inputSource === 'node' && props.paramValue.nodeId != null ? props.paramValue : null);
const nodeOutputItems = computed(() => props.node == null ? [] : getNodeOutputItems(nodes.value, props.node.id, inputDataType.value, paramDefs.value, effectDefinitions.value, nodeConnection.value));
const controlComponent = useTemplateRef('controlComponent');
const inlineFunctionCurveEditorOpen = ref(false);

let mounted = true;
onBeforeUnmount(() => { mounted = false; });
// 点の保存でもNodes Effectの表示モデルは作り直される。所有者の切り替えは親のkeyに任せ、ここでは編集中のBindingを識別する。
watch([
	() => props.node?.id,
	() => paramPathKey(props.paramPath),
	() => props.paramValue.inputSource,
	() => curveBinding.value?.source,
	() => selectedSharedFunctionCurve.value?.id,
], () => {
	inlineFunctionCurveEditorOpen.value = false;
	projectFunctionCurveEditorOpen.value = false;
});

function target() {
	return { paramPath: props.paramPath };
}

watchEffect(onCleanup => {
	const row = rowEl.value;
	if (!row || !canNode.value || props.node == null) return;
	onCleanup(registerWireInput(row, connectNode,
		connection => nodeOutputItems.value.find(item => item.value === nodeOutputKey(connection))?.typeCompatible ?? null));
});

watchEffect(onCleanup => {
	const el = portEl.value;
	const nodeId = props.node?.id;
	const key = paramPathKey(props.paramPath);
	if (el == null || nodeId == null || !canNode.value) return;
	wireMap.in[nodeId] ??= {};
	wireMap.in[nodeId][key] = el;
	onCleanup(() => {
		if (wireMap.in[nodeId]?.[key] === el) delete wireMap.in[nodeId][key];
	});
});

watchEffect(onCleanup => {
	const element = collapsedPortEl.value;
	const nodeId = props.node?.id;
	if (element == null || nodeId == null || expanded.value) return;
	const key = paramPathKey(props.paramPath);
	// 仮想ポートは隠れた入力への描画用の集約先であり、struct・array自体には接続させない。
	wireMap.collapsedParameters[nodeId] ??= {};
	wireMap.collapsedParameters[nodeId][key] = element;
	onCleanup(() => {
		if (wireMap.collapsedParameters[nodeId]?.[key] === element) delete wireMap.collapsedParameters[nodeId][key];
	});
});

const aisParser = new AiScript.Parser();
const expressionModifier = computed(() => isValueParameterBinding(props.paramValue) ? props.paramValue.expressionModifier ?? null : null);

function hasExpressionSyntaxError(code: string): boolean {
	try { return code.trim() === '' || aisParser.parse(code).length === 0; } catch { return true; }
}

function updateInlineCurveAnimationNormalization(axis: 'x' | 'y', normalized: boolean) {
	const value = props.paramValue;
	if (value.inputSource !== 'curveAnimationInline' || value.curveAnimation.curveBinding.source !== 'inline') return;
	const updated = axis === 'x' ? setInlineCurveAnimationXNormalized(value, normalized) : setInlineCurveAnimationYNormalized(value, normalized);
	emit('edit', { kind: 'curveAnimationInline', ...target(), value: updated });
}

function updateCurveAnimationOptions(options: Partial<CurveAnimation>) {
	if (props.paramValue.inputSource !== 'curveAnimationInline') return;
	const curveAnimation = { ...props.paramValue.curveAnimation, ...options };
	if (!isValidCurveAnimationYRange(curveAnimation)) return;
	emit('edit', { kind: 'curveAnimationInline', ...target(), value: { ...props.paramValue, curveAnimation } });
}

function updateInlineFunctionCurve(curve: FunctionCurve, mergeKey: string | null) {
	const value = props.paramValue;
	if (!mounted || value.inputSource !== 'curveAnimationInline' || value.curveAnimation.curveBinding.source !== 'inline') return;
	const curveAnimation: CurveAnimation = { ...value.curveAnimation, curveBinding: { source: 'inline', curve: deepClone(curve) } };
	emit('edit', { kind: 'curveAnimationInline', ...target(), mergeKey: mergeKey ?? undefined, value: { ...value, curveAnimation } });
}

function updateCurveAnimationDuration(trimmedDurationMs: number) {
	if (Number.isFinite(trimmedDurationMs) && trimmedDurationMs > 0) updateCurveAnimationOptions({ trimmedDurationMs });
}

function updateProjectFunctionCurve(curve: FunctionCurve, mergeKey: string | null) {
	const selected = selectedProjectFunctionCurve.value;
	if (selected == null) return;
	projectSession.projectContext.stateManager.commit('replaceProjectFunctionCurve', {
		functionCurveId: selected.id,
		definition: { ...curve, nameForReference: selected.nameForReference },
	}, mergeKey);
}

function useInlineFunctionCurve() {
	if (inlineFunctionCurve.value != null) return;
	const selected = selectedSharedFunctionCurve.value;
	if (selected == null) {
		updateCurveAnimationOptions({ curveBinding: createInlineCurveAnimation().curveAnimation.curveBinding });
		return;
	}
	const { id, nameForReference, ...curve } = selected;
	updateCurveAnimationOptions({ curveBinding: { source: 'inline', curve: duplicateFunctionCurve(curve) } });
}

function selectFunctionCurve(ev: PointerEvent) {
	const binding = curveBinding.value;
	ui.popupMenu([
		{ text: i18n.ts._FunctionCurve.InlineFunctionCurve, active: binding?.source === 'inline', action: useInlineFunctionCurve },
		{ text: i18n.ts.None, active: binding?.source === 'reference' && binding.curveId == null, action: () => updateCurveAnimationOptions({ curveBinding: { source: 'reference', curveId: null } }) },
		...([
			{ functionCurves: props.functionCurves, label: i18n.ts._FunctionCurve.LocalFunctionCurves },
			{ functionCurves: props.projectFunctionCurves ?? [], label: i18n.ts._FunctionCurve.ProjectFunctionCurves },
		]).flatMap<MenuItem>(({ functionCurves, label }) => functionCurves.length === 0 ? [] : [
			{ type: 'label', text: label },
			...functionCurves.map(functionCurve => ({
				text: functionCurve.nameForReference,
				active: binding?.source === 'reference' && binding.curveId === functionCurve.id,
				action: () => updateCurveAnimationOptions({ curveBinding: { source: 'reference', curveId: functionCurve.id } }),
			})),
		]),
	], ev.currentTarget ?? ev.target);
}

function combineComponents() {
	emit('edit', { kind: 'inputSource', ...target(), inputSource: 'literal' });
}

function splitComponents() {
	emit('edit', { kind: 'inputSource', ...target(), inputSource: 'components' });
}

function getMenu() {
	const menuItems: MenuItem[] = [];

	// コンテナの構造とFunction Curveの入力方式は固定し、値の編集は専用のコントロールで行う。
	if (props.paramDef.dataType.kind !== 'array' && props.paramDef.dataType.kind !== 'struct' && props.paramDef.dataType.kind !== 'functionCurve') {
		const children: MenuItem[] = [];
		const types: { text: string; inputSource: EditableParameterBinding['inputSource']; icon: string }[] = [
			{ text: i18n.ts._Parameter.Literal, inputSource: 'literal', icon: 'ti ti-adjustments-horizontal' },
			{ text: i18n.ts._Parameter.EnvironmentVariable, inputSource: 'envVariable', icon: 'ti ti-variable' },
			{ text: i18n.ts._Parameter.Expression, inputSource: 'expression', icon: 'ti ti-math-function' },
			{ text: i18n.ts._Parameter.Keyframes, inputSource: 'keyframesTimelineInline', icon: 'ti ti-timeline' },
			{ text: i18n.ts._Parameter.CurveAnimation, inputSource: 'curveAnimationInline', icon: 'ti ti-ease-in-out-control-points' },
		];
		if (props.paramDef.dataType.kind === 'audioSource') {
			types.splice(1);
			if (props.anotherLayerAudioOptions != null) types.push(
				{ text: i18n.ts._Parameter.LowerLayerAudio, inputSource: 'lowerLayerAudio', icon: 'ti ti-wave-sine' },
				{ text: i18n.ts._Parameter.AnotherLayerAudio, inputSource: 'anotherLayerAudio', icon: 'ti ti-wave-sine' },
			);
		}
		if (timelineEditor != null && props.node == null && props.nodesEffectParameterReferencesEnabled !== true && props.paramDef.dataType.kind !== 'audioSource') types.push({ text: i18n.ts._Parameter.PublicParameter, inputSource: 'timelineLayerPublicParameterReference', icon: 'ti ti-wifi' });
		if (props.node != null || props.nodesEffectParameterReferencesEnabled === true) {
			types.push({ text: i18n.ts._Parameter.PublicParameter, inputSource: 'nodesEffectPublicParameterReference', icon: 'ti ti-wifi' });
			if ((NODES_EFFECT_CUSTOM_PARAMETER_TYPES as readonly string[]).includes(props.paramDef.dataType.kind)) types.push({ text: i18n.ts._Parameter.CustomParameter, inputSource: 'nodesEffectCustomParameterValueReference', icon: 'ti ti-remote-control' });
		}
		if (canNode.value && props.node != null) types.push({ text: i18n.ts._Parameter.Node, inputSource: 'node', icon: 'ti ti-plug' });
		if (props.imageInputEnabled && canNode.value && canConnectNodeDataTypes({ kind: 'color' }, inputDataType.value)) {
			types.push({ text: i18n.ts._Parameter.LowerLayerOutput, inputSource: 'lowerLayerOutput', icon: 'ti ti-stack-2' });
			if (props.imageLayerOptions != null) types.push({ text: i18n.ts._Parameter.AnotherLayerOutput, inputSource: 'anotherLayerOutput', icon: 'ti ti-stack' });
		}
		if (props.previewMediaInputEnabled === true) {
			if (canUseEffectLivePreviewInput(props.paramDef, 'previewInputImage')) types.push({ text: i18n.ts._EffectPreview.ImageInput, inputSource: 'previewInputImage', icon: 'ti ti-photo' });
			if (canUseEffectLivePreviewInput(props.paramDef, 'previewInputAudio')) types.push({ text: i18n.ts._EffectPreview.AudioInput, inputSource: 'previewInputAudio', icon: 'ti ti-wave-sine' });
		}
		for (const { text, inputSource, icon } of types) {
			if (vectorComponents.value != null) break;
			if (props.vectorComponent === true && (inputSource === 'envVariable' || inputSource === 'timelineLayerPublicParameterReference')) continue;
			if (props.paramDef.dataType.kind === 'colorRamp' && inputSource === 'curveAnimationInline') continue;
			if (inputSource === 'keyframesTimelineInline' && (!props.keyframesEnabled || !isKeyframesDataType(props.paramDef.dataType))) continue;
			children.push({
				id: `inputSource:${inputSource}`,
				text,
				icon,
				active: props.paramValue.inputSource === inputSource,
				action: () => emit('edit', { kind: 'inputSource', ...target(), inputSource }),
			});
		}

		if (children.length > 0) {
			menuItems.push({
				type: 'parent',
				icon: 'ti ti-adjustments-horizontal',
				text: i18n.ts._Parameter.InputSource + '...',
				children,
			});
		}
		if (props.paramDef.dataType.kind === 'vector') {
			if (vectorComponents.value != null) {
				menuItems.push({
					id: 'combineComponents',
					text: i18n.ts._Parameter.CombineComponents,
					icon: 'ti ti-arrows-join-2',
					action: () => combineComponents(),
				});
			} else {
				menuItems.push({
					id: 'splitComponents',
					text: i18n.ts._Parameter.Decompose,
					icon: 'ti ti-arrows-split-2',
					action: () => splitComponents(),
				});
			}
		}

		if (expressionModifier.value == null && supportsParameterExpressionModifier(props.paramDef, props.paramValue)) {
			menuItems.push({
				id: 'addExpressionModifier',
				text: i18n.ts._Parameter.ExpressionModifier,
				icon: 'ti ti-math-function',
				action: () => emit('edit', { kind: 'expressionModifier', ...target(), value: { enabled: true, code: 'VALUE' } }),
			});
		}
	}

	const hasPublicParameterOwner = props.node != null ? props.nodesEffect != null
		: props.nodesEffectParameterReferencesEnabled !== true && timelineEditor?.context.value != null && !timelineEditor.isPublicParameterValue;
	if (props.vectorComponent !== true && hasPublicParameterOwner && !isEffectLivePreviewMediaBinding(props.paramValue) && canCreateNamedParameterFromBinding(props.paramDef, props.paramValue)) {
		menuItems.push({
			id: 'createPublicParameter',
			text: i18n.ts._Parameter.CreatePublicParameter,
			icon: 'ti ti-wifi',
			action: () => emit('edit', { kind: 'createPublicParameter', ...target() }),
		});
	}
	if (props.node != null && props.nodesEffect != null && !isEffectLivePreviewMediaBinding(props.paramValue) && canCreateNamedParameterFromBinding(props.paramDef, props.paramValue)) {
		menuItems.push({
			id: 'createCustomParameter',
			text: i18n.ts._Parameter.CreateCustomParameter,
			icon: 'ti ti-remote-control',
			action: () => emit('edit', { kind: 'createCustomParameter', ...target() }),
		});
	}

	if (menuItems.length > 0) {
		menuItems.push({ type: 'divider' });
	}

	menuItems.push(...[{
		text: i18n.ts._Parameter.Edit,
		icon: 'ti ti-forms',
		action: () => controlComponent.value?.directEdit?.(),
	}, {
		text: i18n.ts.Copy,
		id: 'copyParameter',
		icon: 'ti ti-copy',
		action: () => emit('edit', { kind: 'copy', ...target() }),
	}, {
		text: i18n.ts.Paste,
		id: 'pasteParameter',
		icon: 'ti ti-clipboard',
		action: () => emit('edit', { kind: 'paste', ...target() }),
	}, {
		text: i18n.ts._Parameter.CopyId,
		id: 'copyParameterId',
		icon: 'ti ti-hash',
		action: () => clipboardText.writeText(props.paramPath[props.paramPath.length - 1]),
	}, {
		text: i18n.ts.Reset,
		icon: 'ti ti-refresh',
		danger: true,
		action: () => emit('edit', { kind: 'reset', ...target() }),
	}]);

	return menuItems;
}

function showMenu(ev: PointerEvent) {
	ui.popupMenu(getMenu(), ev.currentTarget ?? ev.target);
}

function showNodeInputMenu(ev: PointerEvent) {
	const abortController = new AbortController();

	const menuItems: MenuItem[] = [{
		text: i18n.ts._Parameter.Disconnect,
		danger: true,
		action: () => {
			abortController.abort();
			connectNode(null);
		},
	}, {
		type: 'divider',
	}, {
		type: 'label',
		text: i18n.ts._Parameter.Sampling,
	}];

	if (nodeConnection.value != null) {
		const nodeInputSamplingMenuItems = getNodeInputSamplingMenuItems(nodeConnection as Ref<NodeOutputReference>, value => connectNode(value, false));
		menuItems.push(...nodeInputSamplingMenuItems);
	}

	ui.popupMenu(menuItems, ev.currentTarget ?? ev.target, {
		abortSignal: abortController.signal,
	});
}

function showAnotherLayerOutputSamplingMenu(ev: PointerEvent) {
	if (anotherLayerOutputConnection.value == null) return;
	ui.popupMenu(getNodeInputSamplingMenuItems(computed(() => anotherLayerOutputConnection.value?.sampling ?? { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' }),
		sampling => emit('edit', { kind: 'anotherLayerOutput', ...target(), value: { ...anotherLayerOutputConnection.value!, sampling } })), ev.currentTarget ?? ev.target);
}

function showLowerLayerOutputSamplingMenu(ev: PointerEvent) {
	if (lowerLayerOutputConnection.value == null) return;
	ui.popupMenu(getNodeInputSamplingMenuItems(computed(() => lowerLayerOutputConnection.value?.sampling ?? { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' }),
		sampling => emit('edit', { kind: 'lowerLayerOutput', ...target(), value: { ...lowerLayerOutputConnection.value!, sampling } })), ev.currentTarget ?? ev.target);
}

function onRowContextmenu(ev: PointerEvent) {
	ui.contextMenu(getMenu(), ev);
}

function updateParamAsLiteral(value: any, mergeKey: string | null = null) {
	if (!mounted) return;
	const edit: ParamEdit = { kind: 'literal', ...target(), value };
	if (mergeKey != null) edit.mergeKey = mergeKey;
	emit('edit', edit);
}

function updateParamAsExpression(value: string) {
	if (mounted) emit('edit', {
		kind: 'expression',
		...target(),
		value,
	});
}

function updateExpressionModifier(changes: Partial<ParameterExpressionModifier>) {
	if (!mounted || expressionModifier.value == null) return;
	emit('edit', { kind: 'expressionModifier', ...target(), value: { ...expressionModifier.value, ...changes } });
}

function removeExpressionModifier() {
	emit('edit', { kind: 'expressionModifier', ...target(), value: null });
}

function connectNode(value: NodeOutputReference | null, preserveSampling = true) {
	if (!canNode.value) return;
	// 別のNodesEffectや、グラフ切り替え前の候補へ接続しない。
	if (value != null && !nodeOutputItems.value.some(item => item.value === nodeOutputKey(value))) return;
	if (mounted) emit('edit', {
		kind: 'node',
		...target(),
		value,
		preserveSampling,
	});
}

function updateParamAsNode(key: string | null) {
	if (key === nodeOutputKey(nodeConnection.value)) return;
	if (key == null) {
		connectNode(null);
		return;
	}
	const item = nodeOutputItems.value.find(item => item.value === key);
	if (item != null) connectNode(item.connection);
}

function addElement() {
	if (!canAddArrayElement.value) return;
	emit('edit', { kind: 'addElement', ...target() });
}

function removeElement(elementId: string) {
	emit('edit', { kind: 'removeElement', ...target(), elementId });
}

function onReset() {
	emit('edit', { kind: 'reset', ...target() });
}
</script>

<style module lang="scss">
.root {
	min-width: 0;
}

.row {
	display: flex;
	padding: 2px 10px;
	box-sizing: border-box;

	&:hover {
		background: #ffffff08;
	}
}

.containerRow {
	// コンテナの本体には値入力がない。仮想ポートを表示しても見出しが潰れないよう、
	// 要素数や操作ボタンに必要な幅だけ残し、見出しへ残りの幅を割り当てる。
	.paramHeader {
		width: auto;
		flex: 1;
	}

	.paramBody {
		width: auto;
		flex-shrink: 0;
	}
}

.paramHeader {
	display: flex;
	align-items: center;
	gap: 8px;
	place-content: center left;
	width: 35%;
	box-sizing: border-box;
	padding-right: 12px;
	flex-shrink: 0;

	&.isDyamic {
	}
}

.paramLabel {
	flex: 1;
	min-width: 0;
	white-space: nowrap;
	text-overflow: ellipsis;
	overflow: clip;
	cursor: pointer;
}

.collapseButton {
	display: grid;
	place-items: center;
	width: var(--NODE_PORT_SIZE, 16px);
	height: var(--NODE_PORT_SIZE, 16px);
	flex-shrink: 0;
}

.typeIcon {
}

.paramBody {
	display: flex;
	width: 65%;
	min-width: 0;
	flex-shrink: 1;
	align-items: center;
	justify-content: flex-end;
	gap: 8px;
}

.control {
	flex: 1;
	min-width: 0;
}

.children {
	margin-left: 16px;
	border-left: 1px solid #ffffff18;

	&:hover {
		border-left: 1px solid #ffffff30;
	}
}

.expressionModifier {
	margin: 4px 10px 8px;
	padding: 8px;
	border-left: 2px solid var(--THEME-accent);
	background: #ffffff05;
}

.modifierHeader {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 6px;
}

.count {
	opacity: 0.6;
}

.typeWarning {
	color: var(--THEME-warn);
}
</style>
