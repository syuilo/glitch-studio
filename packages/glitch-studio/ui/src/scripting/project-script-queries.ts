import * as z from 'zod';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { findTimelineLayer } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import { isTimelineContainerLayer } from '@gs/subsystems_timeline_shared/types.ts';
import { getCustomNodeGraphEffect, listCustomNodeGraphEffects } from '../utility/custom-node-graph-effect-target.ts';
import { getEffectDefinitions, listSelectableEffects } from '../utility/project-effects.ts';
import { getLayerParameterDefinitions, getLayerParameterTargets, getLayerParameterValues } from '../utility/timeline-scene.ts';
import { parseProjectApiValue } from '../project-api/contract.ts';
import { customNodeGraphEffectTargetSchema, customNodeGraphEffectNodeReferenceSchema } from '../commands/custom-node-graph-effect-contract-schemas.ts';
import { timelineSceneReferenceSchema, timelineLayerReferenceSchema, timelineClipReferenceSchema } from '../commands/timeline-contract-schemas.ts';
import {
	assetReferenceSchema, effectReferenceSchema, projectAutomationGraphReferenceSchema, customShaderEffectReferenceSchema,
	projectSummarySchema, customNodeGraphEffectSummarySchema, customNodeGraphEffectResultSchema, customNodeGraphEffectNodeSummarySchema, customNodeGraphEffectNodeResultSchema,
	timelineSceneSummarySchema, timelineSceneResultSchema, timelineLayerSummarySchema, timelineLayerResultSchema, timelineClipResultSchema, timelineLayerParametersSchema,
	assetMetadataSchema, effectSummarySchema, effectDefinitionResultSchema,
	projectAutomationGraphResultSchema, customShaderEffectSummarySchema, customShaderEffectResultSchema,
} from './project-script-query-schemas.ts';
import type { ProjectApiContract } from '../project-api/contract.ts';
import type { CustomNodeGraphEffectTarget } from '@gs/glitch-studio_shared/project/custom-node-graph-effect-target.ts';
import type { TimelineLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { ProjectAsset, ProjectState } from '../Project.ts';

export type ProjectScriptQueryDefinition<InputSchema extends z.ZodType = z.ZodType, ResultSchema extends z.ZodType = z.ZodType> = ProjectApiContract<InputSchema, ResultSchema> & {
	argumentCount: 0 | 1;
	execute(state: ProjectState, input: z.output<InputSchema>): z.input<ResultSchema>;
};

function defineQuery<InputSchema extends z.ZodType, ResultSchema extends z.ZodType>(definition: ProjectScriptQueryDefinition<InputSchema, ResultSchema>) {
	return definition;
}

function snapshot<Value>(value: Value): Value {
	// 取得したデータの書き換えではプロジェクトや共通のEffect定義を編集できない。
	// ここへ渡す値は保存データと定義だけに限定し、Assetのバイナリは先に除く。
	return deepClone(value as never) as Value;
}

function sceneReference(state: ProjectState, input: { sceneId: string }) {
	const scene = state.timelineScenes.value.find(candidate => candidate.id === input.sceneId);
	if (scene == null) throw new Error(`Timeline Scene not found: ${input.sceneId}`);
	return { scene, target: { sceneId: input.sceneId } };
}

function layerReference(state: ProjectState, input: { sceneId: string; layerId: string }) {
	const { scene, target } = sceneReference(state, input);
	const layer = findTimelineLayer(scene.layers, input.layerId);
	if (layer == null) throw new Error(`Timeline Layer not found: ${input.layerId}`);
	return { scene, layer, target: { ...target, layerId: input.layerId } };
}

function customNodeGraphEffectName(state: ProjectState, target: CustomNodeGraphEffectTarget): string {
	if ('customNodeGraphEffectId' in target) {
		const customNodeGraphEffect = state.customNodeGraphEffects.value.find(candidate => candidate.id === target.customNodeGraphEffectId);
		if (customNodeGraphEffect == null) throw new Error(`Custom Node Graph Effect not found: ${target.customNodeGraphEffectId}`);
		return customNodeGraphEffect.name;
	}
	return layerReference(state, { sceneId: target.sceneId, layerId: target.layerId }).layer.name;
}

function assetMetadata(asset: ProjectAsset) {
	return {
		target: { assetId: asset.id }, id: asset.id, name: asset.name, width: asset.width, height: asset.height,
		fileDataType: asset.fileDataType, hash: asset.hash ?? null, isExternalReference: asset.isExternalReference, sourceFilePath: asset.sourceFilePath,
	};
}

/**
 * Queryの契約と実装を同じ定義に置く。呼び出し側と資料生成側で引数や戻り値を
 * 別々に列挙すると、公開APIの変更時に説明だけ古くなるため、ここを唯一の一覧にする。
 * 保存値を返すAPIなので、式の評価・描画待ち・UIの選択は扱わない。
 */
export const PROJECT_SCRIPT_QUERY_DEFINITIONS = {
	'Query:getProject': defineQuery({
		argumentCount: 0, inputSchema: z.null(), resultSchema: projectSummarySchema,
		description: 'Get the current Project metadata, pixel resolution, Timeline frame rate, motion blur and saved export settings. Does not include Custom Node Graph Effects, Scenes or Asset bytes.',
		examples: ['<: Query:getProject()'],
		execute: state => snapshot({
			name: state.name.value, description: state.description.value, author: state.author.value, resolution: state.resolution.value,
			timelineFps: state.timelineFps.value, timelineMotionBlur: state.timelineMotionBlur.value, exportSettings: state.exportSettings.value,
		}),
	}),
	'Query:listCustomNodeGraphEffects': defineQuery({
		argumentCount: 0, inputSchema: z.null(), resultSchema: z.array(customNodeGraphEffectSummarySchema),
		description: 'List registered and inline Custom Node Graph Effects with their names and target references. Pass a returned target to Query:getCustomNodeGraphEffect or a Command accepting a Custom Node Graph Effect reference.',
		examples: ['<: Query:listCustomNodeGraphEffects()'],
		execute: state => listCustomNodeGraphEffects(state).map(({ target }) => ({ target, name: customNodeGraphEffectName(state, target) })),
	}),
	'Query:getCustomNodeGraphEffect': defineQuery({
		argumentCount: 1, inputSchema: customNodeGraphEffectTargetSchema, resultSchema: customNodeGraphEffectResultSchema,
		description: 'Get a detached Custom Node Graph Effect definition including Nodes, bindings, public/custom parameters, outputs and Automation Graphs. Supports registered and inline Custom Node Graph Effects. Values are stored bindings rather than evaluated values.',
		examples: ['let customNodeGraphEffect = Command:createCustomNodeGraphEffect({ name: "Generated" })\n<: Query:getCustomNodeGraphEffect(customNodeGraphEffect)'],
		execute(state, target) {
			return snapshot({ ...getCustomNodeGraphEffect(state, target), target, name: customNodeGraphEffectName(state, target) });
		},
	}),
	'Query:listNodes': defineQuery({
		argumentCount: 1, inputSchema: customNodeGraphEffectTargetSchema, resultSchema: z.array(customNodeGraphEffectNodeSummarySchema),
		description: 'List the Nodes of a Custom Node Graph Effect in stored order with their types, display names and target references. Includes input, output and relay Nodes; their effectSource is null.',
		examples: ['let customNodeGraphEffect = Command:createCustomNodeGraphEffect({})\n<: Query:listNodes(customNodeGraphEffect)'],
		execute: (state, customNodeGraphEffect) => snapshot(getCustomNodeGraphEffect(state, customNodeGraphEffect).nodes.map(node => ({
			target: { customNodeGraphEffect, nodeId: node.id }, id: node.id, type: node.type,
			effectSource: node.type === 'effect' ? node.effectSource : null,
			displayName: node.type === 'effect' ? node.displayName : node.type === 'relay' ? node.label ?? '' : '',
		}))),
	}),
	'Query:getNode': defineQuery({
		argumentCount: 1, inputSchema: customNodeGraphEffectNodeReferenceSchema, resultSchema: customNodeGraphEffectNodeResultSchema,
		description: 'Get a detached Custom Node Graph Effect Node and its target reference. Effect Nodes include stored parameter bindings, static settings, resolution and bypass state. Obtain parameter definitions through Query:getEffect.',
		examples: ['let customNodeGraphEffect = Command:createCustomNodeGraphEffect({})\nlet node = Command:createCustomNodeGraphEffectEffectNode({ customNodeGraphEffect: customNodeGraphEffect, effectSource: { type: "nativeEffect", id: "fill" } })\n<: Query:getNode(node)'],
		execute(state, { customNodeGraphEffect, nodeId }) {
			const node = getCustomNodeGraphEffect(state, customNodeGraphEffect).nodes.find(candidate => candidate.id === nodeId);
			if (node == null) throw new Error(`Custom Node Graph Effect Node not found: ${nodeId}`);
			return snapshot({ ...node, target: { customNodeGraphEffect, nodeId } });
		},
	}),
	'Query:listTimelineScenes': defineQuery({
		argumentCount: 0, inputSchema: z.null(), resultSchema: z.array(timelineSceneSummarySchema),
		description: 'List Timeline Scenes with names, resolution settings and target references. A project resolution setting inherits the Project pixel dimensions.',
		examples: ['<: Query:listTimelineScenes()'],
		execute: state => snapshot(state.timelineScenes.value.map(scene => ({ target: { sceneId: scene.id }, name: scene.name, resolution: scene.resolution }))),
	}),
	'Query:getTimelineScene': defineQuery({
		argumentCount: 1, inputSchema: timelineSceneReferenceSchema, resultSchema: timelineSceneResultSchema,
		description: 'Get a detached Timeline Scene including its complete nested Layer tree and Clips. Layer arrays follow editor display order, from top to bottom. Scene references in Clips are not expanded.',
		examples: ['let scene = Command:createTimelineScene({ name: "Generated" })\n<: Query:getTimelineScene(scene)'],
		execute(state, input) { const { scene, target } = sceneReference(state, input); return snapshot({ ...scene, target }); },
	}),
	'Query:listTimelineLayers': defineQuery({
		argumentCount: 1, inputSchema: timelineSceneReferenceSchema, resultSchema: z.array(timelineLayerSummarySchema),
		description: 'List all Layers in a Scene, including descendants, in display order. parentLayerId preserves the tree structure and is null at the root. Referenced Scenes are not traversed.',
		examples: ['let scene = Command:createTimelineScene({})\n<: Query:listTimelineLayers(scene)'],
		execute(state, input) {
			const { scene, target } = sceneReference(state, input);
			const layers: { target: { sceneId: string; layerId: string }; parentLayerId: string | null; name: string; layerType: TimelineLayer['layerType']; isDisabled: boolean; isSolo: boolean }[] = [];
			const visit = (children: readonly TimelineLayer[], parentLayerId: string | null) => {
				for (const layer of children) {
					layers.push({ target: { ...target, layerId: layer.id }, parentLayerId, name: layer.name, layerType: layer.layerType, isDisabled: layer.isDisabled, isSolo: layer.isSolo });
					if (isTimelineContainerLayer(layer)) visit(layer.layers, layer.id);
				}
			};
			visit(scene.layers, null);
			return layers;
		},
	}),
	'Query:getTimelineLayer': defineQuery({
		argumentCount: 1, inputSchema: timelineLayerReferenceSchema, resultSchema: timelineLayerResultSchema,
		description: 'Get a detached Timeline Layer with stored bindings and Clips, or child Layers for a container. The result includes a target reference accepted by Layer Commands.',
		examples: ['let scene = Command:createTimelineScene({})\nlet layer = Command:createTimelineLayer({ sceneId: scene.sceneId, layer: { layerType: "text" } })\n<: Query:getTimelineLayer(layer)'],
		execute(state, input) { const { layer, target } = layerReference(state, input); return snapshot({ ...layer, target }); },
	}),
	'Query:getTimelineLayerParameters': defineQuery({
		argumentCount: 1, inputSchema: timelineLayerReferenceSchema, resultSchema: timelineLayerParametersSchema,
		description: 'Get available parameter groups, their definitions and stored bindings for a Timeline Layer. The effect group contains the parameters of the placed Effect. The publicParameter group contains parameters declared by the Layer. Missing bindings may use definition defaults.',
		examples: ['let scene = Command:createTimelineScene({})\nlet layer = Command:createTimelineLayer({ sceneId: scene.sceneId, layer: { layerType: "text" } })\n<: Query:getTimelineLayerParameters(layer)'],
		execute(state, input) {
			const { layer } = layerReference(state, input);
			return snapshot(Object.fromEntries(getLayerParameterTargets(layer).map(group => [group, {
				definitions: getLayerParameterDefinitions(state, layer, group), values: getLayerParameterValues(layer, group),
			}])));
		},
	}),
	'Query:listTimelineClips': defineQuery({
		argumentCount: 1, inputSchema: timelineLayerReferenceSchema, resultSchema: z.array(timelineClipResultSchema),
		description: 'Get the Clips owned directly by a Timeline Layer with target references. Returns an empty array for containers. Timing fields ending in Ms are milliseconds; source timing and Scene placement are distinct.',
		examples: ['let scene = Command:createTimelineScene({})\nlet layer = Command:createTimelineLayer({ sceneId: scene.sceneId, layer: { layerType: "text" } })\n<: Query:listTimelineClips(layer)'],
		execute(state, input) {
			const { layer, target } = layerReference(state, input);
			return isTimelineContainerLayer(layer) ? [] : snapshot(layer.clips.map(clip => ({ ...clip, target: { ...target, clipId: clip.id } })));
		},
	}),
	'Query:getTimelineClip': defineQuery({
		argumentCount: 1, inputSchema: timelineClipReferenceSchema, resultSchema: timelineClipResultSchema,
		description: 'Get a detached Clip by its Scene, Layer and Clip IDs. Timing fields ending in Ms are milliseconds. The stored Clip variant determines whether it has an Asset, Scene source, loop or fixed video frame.',
		examples: ['let scene = Command:createTimelineScene({})\nlet layer = Command:createTimelineLayer({ sceneId: scene.sceneId, layer: { layerType: "text" }, clips: [{ startMs: 0, durationMs: 1000, contentOffsetMs: 0 }] })\nlet clip = Query:listTimelineClips(layer)[0]\n<: Query:getTimelineClip(clip.target)'],
		execute(state, input) {
			const { layer, target } = layerReference(state, input);
			const clip = isTimelineContainerLayer(layer) ? null : layer.clips.find(candidate => candidate.id === input.clipId);
			if (clip == null) throw new Error(`Timeline Clip not found: ${input.clipId}`);
			return snapshot({ ...clip, target: { ...target, clipId: input.clipId } });
		},
	}),
	'Query:listAssets': defineQuery({
		argumentCount: 0, inputSchema: z.null(), resultSchema: z.array(assetMetadataSchema),
		description: 'List existing Asset metadata and target references. Includes MIME type, pixel dimensions and source path; excludes file bytes and thumbnails. Does not import or read new files.',
		examples: ['<: Query:listAssets()'],
		execute: state => state.assets.value.map(assetMetadata),
	}),
	'Query:getAsset': defineQuery({
		argumentCount: 1, inputSchema: assetReferenceSchema, resultSchema: assetMetadataSchema,
		description: 'Get existing Asset metadata by ID. Returns no file bytes or thumbnails, and does not resolve or read the external source path.',
		examples: ['each (let asset, Query:listAssets()) { <: Query:getAsset(asset.target) }'],
		execute(state, { assetId }) {
			const asset = state.assets.value.find(candidate => candidate.id === assetId);
			if (asset == null) throw new Error(`Asset not found: ${assetId}`);
			return assetMetadata(asset);
		},
	}),
	'Query:listEffects': defineQuery({
		argumentCount: 0, inputSchema: z.null(), resultSchema: z.array(effectSummarySchema),
		description: 'List Native Effects, registered Custom Shader Effects and registered Custom Node Graph Effects with their display names, summaries, kinds and tags. Pass a returned target to Query:getEffect to inspect its ports before choosing a placement.',
		examples: ['<: Query:listEffects()'],
		execute: state => snapshot(listSelectableEffects(state).map(effect => ({
			target: { effectSource: effect.effectSource }, effectSource: effect.effectSource, displayName: effect.displayName, summary: effect.summary, kind: effect.kind, tags: effect.tags,
		}))),
	}),
	'Query:getEffect': defineQuery({
		argumentCount: 1, inputSchema: effectReferenceSchema, resultSchema: effectDefinitionResultSchema,
		description: 'Get a complete Effect definition: parameter types, defaults, static settings, output ports and primary input/output selection. Color values use linear sRGB and may be outside 0..1; spatial values use the common long-edge unit. Does not include renderer implementation code.',
		examples: ['<: Query:getEffect({ effectSource: { type: "nativeEffect", id: "fill" } })'],
		execute(state, { effectSource }) {
			return snapshot({ ...getEffectDefinitions(state).describe(effectSource), target: { effectSource } });
		},
	}),
	'Query:listProjectAutomationGraphs': defineQuery({
		argumentCount: 0, inputSchema: z.null(), resultSchema: z.array(projectAutomationGraphResultSchema),
		description: 'List complete Project-level Automation Graph definitions with target references. Does not include Automation Graphs owned by Custom Node Graph Effects or Timeline Layers.',
		examples: ['<: Query:listProjectAutomationGraphs()'],
		execute: state => snapshot(state.automationGraphs.value.map(graph => ({ ...graph, target: { automationGraphId: graph.id } }))),
	}),
	'Query:getProjectAutomationGraph': defineQuery({
		argumentCount: 1, inputSchema: projectAutomationGraphReferenceSchema, resultSchema: projectAutomationGraphResultSchema,
		description: 'Get a Project-level Automation Graph with its points, Bezier handles and normalization setting. Returns stored curve data, not its value evaluated at a time.',
		examples: ['each (let graph, Query:listProjectAutomationGraphs()) { <: Query:getProjectAutomationGraph(graph.target) }'],
		execute(state, { automationGraphId }) {
			const graph = state.automationGraphs.value.find(candidate => candidate.id === automationGraphId);
			if (graph == null) throw new Error(`Automation Graph not found: ${automationGraphId}`);
			return snapshot({ ...graph, target: { automationGraphId } });
		},
	}),
	'Query:listCustomShaderEffects': defineQuery({
		argumentCount: 0, inputSchema: z.null(), resultSchema: z.array(customShaderEffectSummarySchema),
		description: 'List Project-owned Custom Shader Effects with names, summaries and customShaderEffectId references. Use Query:getCustomShaderEffect to inspect the editable shader definition.',
		examples: ['<: Query:listCustomShaderEffects()'],
		execute: state => state.customShaderEffects.value.map(effect => ({ target: { customShaderEffectId: effect.id }, name: effect.name, summary: effect.summary })),
	}),
	'Query:getCustomShaderEffect': defineQuery({
		argumentCount: 1, inputSchema: customShaderEffectReferenceSchema, resultSchema: customShaderEffectResultSchema,
		description: 'Get a detached editable Custom Shader Effect definition including WGSL code, shader API version, parameters, output ports and primary connections. Uncompiled code may be present; retrieval does not validate GPU compilation.',
		examples: ['let effect = Command:createCustomShaderEffect({ name: "Generated" })\n<: Query:getCustomShaderEffect(effect)'],
		execute(state, { customShaderEffectId }) {
			const effect = state.customShaderEffects.value.find(candidate => candidate.id === customShaderEffectId);
			if (effect == null) throw new Error(`Custom Shader Effect not found: ${customShaderEffectId}`);
			return snapshot({ ...effect, target: { customShaderEffectId } });
		},
	}),
};

export type ProjectScriptQueryName = keyof typeof PROJECT_SCRIPT_QUERY_DEFINITIONS;

function bindQuery(state: ProjectState, name: string, definition: ProjectScriptQueryDefinition): (...args: unknown[]) => unknown {
	const invoke = (input: unknown) => {
		const parsedInput = parseProjectApiValue(definition.inputSchema, input, `${name} input`);
		const result = definition.execute(state, parsedInput);
		// 検証が返す複製や既知フィールドだけの値へ置き換えない。Queryが用意した
		// 切り離し済みの結果を返し、保存値の省略・追加フィールドもそのまま保持する。
		parseProjectApiValue(definition.resultSchema, result, `${name} result`);
		return result;
	};
	// Runtimeはfunction.lengthで引数数を検査するため、引数なしQueryを
	// 省略可能な一引数関数へ統一せず、公開呼び出し規約を維持する。
	return definition.argumentCount === 0 ? () => invoke(null) : input => invoke(input);
}

export function createProjectScriptQueries(state: ProjectState): Record<ProjectScriptQueryName, (...args: unknown[]) => unknown> {
	return Object.fromEntries(Object.entries(PROJECT_SCRIPT_QUERY_DEFINITIONS).map(([name, definition]) => [name, bindQuery(state, name, definition)])) as Record<ProjectScriptQueryName, (...args: unknown[]) => unknown>;
}
