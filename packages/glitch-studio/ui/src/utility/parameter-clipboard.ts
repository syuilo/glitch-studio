import { areDataTypesEqual } from '@gs/shared/data-type/data-type.ts';
import { areNodeDataTypesCompatible, getNodeInputDataType } from '@gs/shared/data-type/node-compatibility.ts';
import { getArrayElementDefinition, getStructFieldDefinitions, isParameterType } from '@gs/shared/parameter/parameter-definition.ts';
import { isValueParameterBinding } from '@gs/shared/parameter/parameter-binding.ts';
import { resolveParameter } from '@gs/shared/parameter/parameter-path.ts';
import { inspectStaticParameter } from '@gs/shared/parameter/static-parameter.ts';
import { isBlendMode } from '@gs/shared/color-blend.ts';
import { isSizeReference } from '@gs/shared/size-reference.ts';
import { validateColorRamp } from '@gs/shared/color-ramp.ts';
import { isKeyframesDataType, supportsKeyframeInterpolation } from '@gs/shared/keyframes/keyframes-timeline.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { genId } from '@gs/shared/utility/id.ts';
import { getNodeOutputs } from '@gs/subsystems_visual-module_shared/node-outputs.ts';
import { validateVisualModuleAudioBinding } from '@gs/subsystems_visual-module_shared/audio-parameters.ts';
import { validateTimelineParameterTree } from '@gs/subsystems_timeline_shared/parameter-binding.ts';
import { findTimelineLayer } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import { resolveTimelineImageLayerReference } from '@gs/subsystems_timeline_shared/layer-output.ts';
import { resolveTimelineAnotherLayerAudioReference } from '@gs/subsystems_timeline_shared/timeline-audio.ts';
import { getSceneBaseResolution } from '@gs/subsystems_timeline_shared/scene-resolution.ts';
import { getTimelineLayerPublicParameterContext, resolveTimelineLayerPublicParameterReference } from '@gs/subsystems_timeline_shared/public-parameters.ts';
import { validatePlayerAudioSourceSelection } from '@gs/glitch-studio_shared/player-audio-source.ts';
import { visualModuleTargetKey } from '@gs/glitch-studio_shared/project/visual-module-target.ts';
import { getVisualModule } from './visual-module-target.ts';
import { resolveNodeParam } from './node-params.ts';
import { getScene, resolveLayerParameter, getLayerParameterValues, getLayerParameterDefinitions } from './timeline-scene.ts';
import type { DataType } from '@gs/shared/data-type/data-type.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { ParamPath } from '@gs/shared/parameter/parameter-path.ts';
import type { ParameterArrayElement } from '@gs/shared/parameter/parameter-binding.ts';
import type { VisualModule } from '@gs/subsystems_visual-module_shared/types.ts';
import type { TimelineScene, TimelineLayer, TimelineParameterTarget } from '@gs/subsystems_timeline_shared/types.ts';
import type { VisualModuleTarget } from '@gs/glitch-studio_shared/project/visual-module-target.ts';
import type { EditableParameterBinding } from '../types/parameter-edit.ts';
import type { ProjectState } from '../Project.ts';

type ParameterClipboardOwner =
	| { kind: 'visualModule'; target: VisualModuleTarget }
	| { kind: 'timelineLayer'; sceneId: string; layerId: string };

export type ParameterClipboardSource = {
	projectId: string;
	owner: ParameterClipboardOwner;
	// 同じIDのローカル定義を、別の所有者の定義やプロジェクト定義と取り違えない。
	localAutomationGraphIds: string[];
};

export type ParameterClipboardData = {
	format: 'glitch-studio/parameter';
	dataType: DataType;
	binding: EditableParameterBinding;
	source: ParameterClipboardSource;
};

export type ProjectParameterClipboardTarget = { paramPath: ParamPath } & (
	| { kind: 'node'; visualModuleTarget: VisualModuleTarget; nodeId: string }
	| { kind: 'timeline'; sceneId: string; layerId: string; parameterTarget: TimelineParameterTarget }
);

export type ParameterPasteContext = { state: ProjectState; source: ParameterClipboardSource } & (
	| { kind: 'node'; visualModule: VisualModule; nodeId: string }
	| { kind: 'preview'; visualModule: VisualModule }
	| { kind: 'timeline'; scene: TimelineScene; layer: Exclude<TimelineLayer, { layerType: 'folder' }>; parameterTarget: TimelineParameterTarget }
);

function requireValid(condition: boolean): asserts condition {
	if (!condition) throw new Error('Invalid parameter clipboard data');
}

// JSONの境界だけで動的なフィールドを読み、検査後に保存形式の型へ絞り込む。
function object(value: unknown): Record<string, unknown> {
	requireValid(value != null && typeof value === 'object' && !Array.isArray(value));
	return value as Record<string, unknown>;
}

const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const nonemptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const components = (value: unknown, length: number): boolean => Array.isArray(value) && value.length === length && value.every(finiteNumber);
const isOneOf = (value: unknown, options: readonly string[]): boolean => typeof value === 'string' && options.includes(value);
const isWrapMode = (value: unknown): boolean => isOneOf(value, ['clamp', 'repeat', 'repeatMirrored', 'transparent']);

function validateDataType(value: unknown): asserts value is DataType {
	const dataType = object(value);
	if (dataType.kind === 'array') validateDataType(dataType.elementType);
	else if (dataType.kind === 'struct') {
		for (const field of Object.values(object(dataType.fields))) validateDataType(field);
	} else if (dataType.kind === 'enum') {
		requireValid(Array.isArray(dataType.options) && dataType.options.length > 0 && dataType.options.every(nonemptyString)
			&& new Set(dataType.options).size === dataType.options.length);
	} else requireValid(isOneOf(dataType.kind, ['scalar', 'bool', 'string', 'color', 'colorRamp', 'vector', 'blendMode', 'fitMode', 'sizeReference', 'wrapMode', 'audioSource', 'any']));
}

function validateLiteral(dataType: DataType, value: unknown): void {
	switch (dataType.kind) {
		case 'scalar': requireValid(finiteNumber(value)); break;
		case 'bool': requireValid(typeof value === 'boolean'); break;
		case 'string': requireValid(typeof value === 'string'); break;
		case 'vector': requireValid(components(value, 2)); break;
		case 'color': requireValid(components(value, 4)); break;
		case 'colorRamp': validateColorRamp(value); break;
		case 'blendMode': requireValid(isBlendMode(value)); break;
		case 'sizeReference': requireValid(isSizeReference(value)); break;
		case 'fitMode': requireValid(isOneOf(value, ['contain', 'cover', 'stretch'])); break;
		case 'wrapMode': requireValid(isWrapMode(value)); break;
		case 'enum': requireValid(typeof value === 'string' && dataType.options.includes(value)); break;
		case 'audioSource': validatePlayerAudioSourceSelection(value); break;
		case 'any': requireValid(value === null || components(value, 4)); break;
		case 'array': {
			requireValid(Array.isArray(value));
			const ids = new Set<string>();
			for (const candidate of value) {
				const element = object(candidate);
				requireValid(nonemptyString(element.id) && !ids.has(element.id));
				ids.add(element.id);
				validateBinding(dataType.elementType, element.binding);
			}
			break;
		}
		case 'struct': {
			const fields = object(value);
			requireValid(Object.keys(fields).length === Object.keys(dataType.fields).length);
			for (const [key, fieldType] of Object.entries(dataType.fields)) {
				requireValid(Object.hasOwn(fields, key));
				validateBinding(fieldType, fields[key]);
			}
			break;
		}
	}
}

function validatePlaybackOptions(binding: Record<string, unknown>): void {
	requireValid(binding.trimmedDurationMs === null || (finiteNumber(binding.trimmedDurationMs) && binding.trimmedDurationMs > 0));
	requireValid(isOneOf(binding.offsetMode, ['start', 'end']) && isOneOf(binding.wrapMode, ['clamp', 'repeat', 'repeatMirrored']));
}

function validateSampling(binding: Record<string, unknown>): void {
	requireValid(isOneOf(binding.fitMode, ['contain', 'cover', 'stretch']) && isWrapMode(binding.wrapMode) && isOneOf(binding.filterMode, ['linear', 'nearest']));
}

function validateBinding(dataType: DataType, value: unknown): asserts value is EditableParameterBinding {
	const binding = object(value);
	if (dataType.kind === 'array' || dataType.kind === 'struct') requireValid(binding.inputSource === 'literal');
	if (binding.expressionModifier != null) {
		const modifier = object(binding.expressionModifier);
		requireValid(typeof modifier.enabled === 'boolean' && typeof modifier.code === 'string');
	}
	switch (binding.inputSource) {
		case 'literal': validateLiteral(dataType, binding.value); break;
		case 'expression': requireValid(typeof binding.expression === 'string'); break;
		case 'envVariable': requireValid(typeof binding.variable === 'string'); break;
		case 'automationGraphReference':
			validatePlaybackOptions(binding);
			requireValid(binding.automationGraphId === null || nonemptyString(binding.automationGraphId));
			break;
		case 'automationGraphInline': {
			validatePlaybackOptions(binding);
			const graph = object(binding.automationGraph);
			requireValid(typeof graph.isNormalized === 'boolean' && Array.isArray(graph.points));
			const ids = new Set<string>();
			for (const candidate of graph.points) {
				const point = object(candidate);
				requireValid(nonemptyString(point.id) && !ids.has(point.id) && finiteNumber(point.x) && finiteNumber(point.y)
					&& components(point.bezierControlPointA, 2) && components(point.bezierControlPointB, 2));
				ids.add(point.id);
			}
			break;
		}
		case 'keyframesTimelineInline': {
			validatePlaybackOptions(binding);
			const timeline = object(binding.keyframesTimeline);
			validateDataType(timeline.dataType);
			requireValid(isKeyframesDataType(dataType) && areDataTypesEqual(dataType, timeline.dataType)
				&& typeof timeline.isNormalized === 'boolean' && Array.isArray(timeline.keyframes));
			const ids = new Set<string>();
			for (const candidate of timeline.keyframes) {
				const point = object(candidate);
				requireValid(nonemptyString(point.id) && !ids.has(point.id) && finiteNumber(point.x) && point.x >= 0);
				ids.add(point.id);
				validateLiteral(dataType, point.value);
				const interpolation = object(point.interpolation);
				requireValid(interpolation.type === 'hold' || (supportsKeyframeInterpolation(dataType) && (interpolation.type === 'linear'
					|| (isOneOf(interpolation.type, ['ease:sine', 'ease:quad', 'ease:cubic', 'ease:quart', 'ease:quint', 'ease:expo', 'ease:circ', 'ease:back', 'ease:elastic', 'ease:bounce'])
						&& isOneOf(interpolation.direction, ['in', 'out', 'inOut'])))));
			}
			break;
		}
		case 'node':
			requireValid(binding.nodeId === null ? binding.outputPort === null : nonemptyString(binding.nodeId) && nonemptyString(binding.outputPort));
			if (binding.nodeId != null) validateSampling(binding);
			break;
		case 'visualModulePublicParameterReference': requireValid(typeof binding.parameterId === 'string'); break;
		case 'timelineLayerPublicParameterReference':
			requireValid(binding.layerId === null && binding.parameterId === null || nonemptyString(binding.layerId) && nonemptyString(binding.parameterId));
			break;
		case 'anotherLayerOutput':
			requireValid(binding.layerId === null || nonemptyString(binding.layerId));
			requireValid(isOneOf(binding.outputStage, ['source', 'rendered', 'composited']));
			if ('fitMode' in binding || 'wrapMode' in binding || 'filterMode' in binding) validateSampling(binding);
			break;
		case 'lowerLayerOutput':
			if ('fitMode' in binding || 'wrapMode' in binding || 'filterMode' in binding) validateSampling(binding);
			break;
		case 'anotherLayerAudio': requireValid(binding.layerId === null || nonemptyString(binding.layerId)); break;
		case 'lowerLayerAudio': break;
		default: throw new Error('Unknown parameter input source');
	}
}

export function parseParameterClipboard(text: string): ParameterClipboardData | null {
	try {
		const data = object(JSON.parse(text));
		requireValid(data.format === 'glitch-studio/parameter');
		validateDataType(data.dataType);
		validateBinding(data.dataType, data.binding);
		const source = object(data.source);
		requireValid(nonemptyString(source.projectId) && Array.isArray(source.localAutomationGraphIds) && source.localAutomationGraphIds.every(nonemptyString));
		const owner = object(source.owner);
		if (owner.kind === 'visualModule') {
			const target = object(owner.target);
			requireValid(Object.hasOwn(target, 'visualModuleId') ? nonemptyString(target.visualModuleId)
				: nonemptyString(target.sceneId) && nonemptyString(target.inlineVisualModuleLayerId));
		} else requireValid(owner.kind === 'timelineLayer' && nonemptyString(owner.sceneId) && nonemptyString(owner.layerId));
		return data as unknown as ParameterClipboardData;
	} catch { return null; }
}

export function createParameterClipboard(definition: ParameterDefinition, binding: EditableParameterBinding, source: ParameterClipboardSource): ParameterClipboardData {
	return deepClone({ format: 'glitch-studio/parameter', dataType: definition.dataType, binding, source });
}

export function createVisualModuleClipboardSource(projectId: string, target: VisualModuleTarget, visualModule: VisualModule): ParameterClipboardSource {
	return { projectId, owner: { kind: 'visualModule', target }, localAutomationGraphIds: visualModule.automationGraphs.map(graph => graph.id) };
}

function sameOwner(a: ParameterClipboardSource, b: ParameterClipboardSource): boolean {
	if (a.projectId !== b.projectId) return false;
	return a.owner.kind === 'visualModule' && b.owner.kind === 'visualModule'
		? visualModuleTargetKey(a.owner.target) === visualModuleTargetKey(b.owner.target)
		: a.owner.kind === 'timelineLayer' && b.owner.kind === 'timelineLayer' && a.owner.sceneId === b.owner.sceneId && a.owner.layerId === b.owner.layerId;
}

function sameScene(a: ParameterClipboardSource, b: ParameterClipboardSource): boolean {
	return a.projectId === b.projectId && a.owner.kind === 'timelineLayer' && b.owner.kind === 'timelineLayer' && a.owner.sceneId === b.owner.sceneId;
}

function validateLeafDestination(definition: ParameterDefinition, binding: EditableParameterBinding, source: ParameterClipboardSource, context: ParameterPasteContext): void {
	const sameProject = source.projectId === context.source.projectId;
	if (context.kind === 'timeline') {
		const allowInputs = context.parameterTarget === 'effect' || context.parameterTarget === 'module';
		validateTimelineParameterTree(definition, binding, allowInputs, allowInputs);
	} else {
		requireValid(isValueParameterBinding(binding) || binding.inputSource === 'node' || binding.inputSource === 'visualModulePublicParameterReference');
		if (context.kind === 'preview') requireValid(binding.inputSource !== 'node' && binding.inputSource !== 'visualModulePublicParameterReference');
		validateVisualModuleAudioBinding(definition, binding, context.visualModule.paramDefs);
	}
	switch (binding.inputSource) {
		case 'literal':
			if (definition.dataType.kind === 'audioSource' && binding.value != null) {
				validatePlayerAudioSourceSelection(binding.value);
				requireValid(sameProject && context.state.players.value.some(player => player.id === binding.value.playerId));
			}
			break;
		case 'automationGraphReference': {
			if (binding.automationGraphId == null) break;
			requireValid(sameProject);
			const localGraphs = context.kind === 'timeline' ? context.layer.automationGraphs : context.kind === 'node' ? context.visualModule.automationGraphs : [];
			if (source.localAutomationGraphIds.includes(binding.automationGraphId)) {
				requireValid(sameOwner(source, context.source) && localGraphs.some(graph => graph.id === binding.automationGraphId));
			} else requireValid(context.kind !== 'node' && context.state.automationGraphs.value.some(graph => graph.id === binding.automationGraphId));
			break;
		}
		case 'node': {
			requireValid(context.kind === 'node' && definition.canNode === true);
			if (binding.nodeId == null) break;
			requireValid(sameOwner(source, context.source) && binding.nodeId !== context.nodeId);
			const node = context.visualModule.nodes.find(candidate => candidate.id === binding.nodeId);
			const output = node == null ? null : getNodeOutputs(node, context.visualModule.paramDefs)[binding.outputPort];
			requireValid(output != null && areNodeDataTypesCompatible(output.dataType, getNodeInputDataType(definition)));
			break;
		}
		case 'visualModulePublicParameterReference': {
			requireValid(context.kind === 'node');
			if (binding.parameterId === '') break;
			const parameter = context.visualModule.paramDefs.find(candidate => candidate.id === binding.parameterId);
			requireValid(sameOwner(source, context.source) && parameter != null && parameter.canNode !== true && areDataTypesEqual(parameter.dataType, definition.dataType));
			break;
		}
		case 'timelineLayerPublicParameterReference': {
			requireValid(context.kind === 'timeline');
			if (binding.layerId == null && binding.parameterId == null) break;
			const parameters = getTimelineLayerPublicParameterContext(context.scene.layers, context.layer.id);
			const reference = parameters == null ? null : resolveTimelineLayerPublicParameterReference(parameters, binding.layerId, binding.parameterId, context.parameterTarget === 'publicParameter');
			requireValid(sameScene(source, context.source) && reference != null && areDataTypesEqual(reference.definition.dataType, definition.dataType));
			break;
		}
		case 'anotherLayerOutput':
		case 'lowerLayerOutput': {
			requireValid(context.kind === 'timeline' && definition.canNode === true && areNodeDataTypesCompatible({ kind: 'color' }, getNodeInputDataType(definition)));
			// 公開入力とEffectではサンプリング設定の所有者が違う。設定を暗黙に捨てたり補わない。
			requireValid(context.parameterTarget === 'effect' ? 'fitMode' in binding : !('fitMode' in binding));
			if (binding.inputSource === 'anotherLayerOutput' && binding.layerId != null) {
				requireValid(sameScene(source, context.source) && resolveTimelineImageLayerReference(context.scene.layers, context.layer.id, binding.layerId) != null);
			}
			break;
		}
		case 'anotherLayerAudio':
			if (binding.layerId != null) {
				requireValid(context.kind === 'timeline' && sameScene(source, context.source)
					&& resolveTimelineAnotherLayerAudioReference(context.scene, context.layer.id, binding.layerId) != null);
			}
			break;
	}
}

/** 部分適用や値の変換はせず、保存先で全体を再現できる場合だけ独立したBindingを返す。 */
export function prepareParameterBindingPaste(definition: ParameterDefinition, clipboard: ParameterClipboardData, context: ParameterPasteContext): EditableParameterBinding | null {
	try {
		requireValid(areDataTypesEqual(definition.dataType, clipboard.dataType));
		validateBinding(clipboard.dataType, clipboard.binding);
		const binding = deepClone(clipboard.binding);
		inspectStaticParameter(definition, binding, (leaf, value) => validateLeafDestination(leaf, value, clipboard.source, context));

		function prepareTree(currentDefinition: ParameterDefinition, currentBinding: EditableParameterBinding): void {
			if (currentBinding.inputSource === 'literal' && isParameterType(currentDefinition, 'array')) {
				const elements = currentBinding.value as ParameterArrayElement<EditableParameterBinding>[];
				requireValid(currentDefinition.maxElements == null || elements.length <= currentDefinition.maxElements);
				for (const element of elements) { element.id = genId(); prepareTree(getArrayElementDefinition(currentDefinition), element.binding); }
			} else if (currentBinding.inputSource === 'literal' && currentDefinition.dataType.kind === 'struct') {
				for (const [key, field] of Object.entries(getStructFieldDefinitions(currentDefinition))) prepareTree(field, currentBinding.value[key]);
			} else if (currentBinding.inputSource === 'keyframesTimelineInline') {
				for (const point of currentBinding.keyframesTimeline.keyframes) point.id = genId();
			} else if (currentBinding.inputSource === 'automationGraphInline') {
				for (const point of currentBinding.automationGraph.points) point.id = genId();
			} else if (currentBinding.inputSource === 'literal' && currentDefinition.dataType.kind === 'colorRamp') {
				for (const stop of currentBinding.value.stops) stop.id = genId();
			}
		}

		prepareTree(definition, binding);
		return binding;
	} catch { return null; }
}

export function resolveProjectClipboardTarget(state: ProjectState, projectId: string, target: ProjectParameterClipboardTarget) {
	const rootKey = target.paramPath[0];
	let root: { def: ParameterDefinition; value: EditableParameterBinding };
	let before: EditableParameterBinding | null;
	let context: ParameterPasteContext;
	if (target.kind === 'node') {
		const visualModule = getVisualModule(state, target.visualModuleTarget);
		const node = visualModule.nodes.find(candidate => candidate.id === target.nodeId);
		requireValid(node?.type === 'effect');
		root = resolveNodeParam(node, [rootKey]);
		before = root.value;
		context = { kind: 'node', state, nodeId: node.id, visualModule, source: createVisualModuleClipboardSource(projectId, target.visualModuleTarget, visualModule) };
	} else {
		const scene = getScene(state, target.sceneId);
		const layer = findTimelineLayer(scene.layers, target.layerId);
		requireValid(layer != null && layer.layerType !== 'folder');
		before = getLayerParameterValues(layer, target.parameterTarget)[rootKey] ?? null;
		if (target.parameterTarget === 'camera') {
			// 未設定のCamera Zも、画面に表示したSceneの縦横比に対応する既定値をコピーする。
			const definition = getLayerParameterDefinitions(state, layer, target.parameterTarget, getSceneBaseResolution(scene.resolution, state.resolution.value))[rootKey];
			requireValid(definition != null);
			root = { def: definition, value: before ?? definition.defaultValue };
		} else root = resolveLayerParameter(state, layer, target.parameterTarget, [rootKey]);
		context = { kind: 'timeline', state, scene, layer, parameterTarget: target.parameterTarget, source: {
			projectId, owner: { kind: 'timelineLayer', sceneId: scene.id, layerId: layer.id }, localAutomationGraphIds: layer.automationGraphs.map(graph => graph.id),
		} };
	}
	const draft = { [rootKey]: deepClone(root.value) };
	const parameter = resolveParameter<EditableParameterBinding>({ [rootKey]: root.def }, draft, target.paramPath);
	return { ...parameter, context, before: deepClone(before), draft };
}

/** CommandとUIの事前確認で同じ検査を使う。未設定のルートはUndo用にnullのまま保持する。 */
export function prepareProjectParameterPaste(state: ProjectState, projectId: string, target: ProjectParameterClipboardTarget, clipboard: ParameterClipboardData) {
	try {
		const resolved = resolveProjectClipboardTarget(state, projectId, target);
		const binding = prepareParameterBindingPaste(resolved.def, clipboard, resolved.context);
		if (binding == null) return null;
		resolved.setValue(binding);
		return { before: resolved.before, after: resolved.draft[target.paramPath[0]] };
	} catch { return null; }
}
