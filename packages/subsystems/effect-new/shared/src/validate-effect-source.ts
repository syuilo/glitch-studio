import { areDataTypesEqual, isTextureDataType } from '@gs/shared/data-type/data-type.ts';
import { validateLiteralAudioSourceBinding } from '@gs/shared/parameter/audio-source.ts';
import { isValueParameterBinding } from '@gs/shared/parameter/parameter-binding.ts';
import { inspectStaticParameter, validateParameterDefaultValues } from '@gs/shared/parameter/static-parameter.ts';
import { validateStaticSettings } from '@gs/shared/static-setting.ts';
import { findDependencyCycle } from '@gs/shared/utility/dependency-cycle.ts';
import { validateCustomShaderEffectDefinition } from './custom-shader-effect/types.ts';
import { resolveEffectSource } from './effect-source.ts';
import { validateEffectResolution } from './resolution.ts';
import type { EffectDefinition } from './effect-definition.ts';
import type { EffectSource, EffectCatalog } from './effect-source.ts';
import type { CustomNodeGraphEffect, CustomNodeGraphEffectOutputConnection, CustomNodeGraphEffectParameterBinding } from './custom-node-graph-effect/types.ts';
import type { CustomShaderEffect } from './custom-shader-effect/types.ts';

/** 編集・読み込み時の検査。未使用・バイパス中のノードも対象にし、配置の生成や毎フレームの描画では呼ばない。 */
export function validateEffectSource(source: EffectSource, catalog: EffectCatalog): void {
	const validated = new Set<CustomNodeGraphEffect | CustomShaderEffect>();
	const visiting = new Map<CustomNodeGraphEffect, string>();

	function visit(current: EffectSource, label: string): EffectDefinition {
		const resolved = resolveEffectSource(current, catalog);
		if (resolved.type === 'customShaderEffect' && !validated.has(resolved.customShaderEffect)) {
			validateCustomShaderEffectDefinition(resolved.customShaderEffect);
			validated.add(resolved.customShaderEffect);
		} else if (resolved.type === 'customNodeGraphEffect' && !validated.has(resolved.customNodeGraphEffect)) {
			const graph = resolved.customNodeGraphEffect;
			// 同じ登録定義への複数配置は許可する。現在の参照経路へ戻る場合だけ再帰になる。
			if (visiting.has(graph)) throw new Error('Recursive Custom Node Graph Effect: ' + [...visiting.values(), label].join(' → '));
			visiting.set(graph, label);
			validateGraph(graph, visit);
			visiting.delete(graph);
			validated.add(graph);
		}
		return resolved.definition;
	}

	visit(source, 'id' in source ? source.id : source.type);
}

function validateGraph(graph: CustomNodeGraphEffect, visit: (source: EffectSource, label: string) => EffectDefinition): void {
	const publicParameters = new Map(graph.paramDefs.map(parameter => [parameter.id, parameter]));
	if (publicParameters.size !== graph.paramDefs.length || new Set(graph.paramDefs.map(parameter => parameter.nameForReference)).size !== graph.paramDefs.length) {
		throw new Error('Public parameter ID and name must be unique');
	}
	for (const parameter of graph.paramDefs) validateParameterDefaultValues(parameter);
	const outputIds = new Set(graph.outputDefs.map(output => output.id));
	if (outputIds.size !== graph.outputDefs.length) throw new Error('Duplicate output ID');
	if (graph.primaryOutputId != null && !outputIds.has(graph.primaryOutputId)) throw new Error('Invalid primary output');
	if (graph.primaryInputId != null) {
		const primary = publicParameters.get(graph.primaryInputId);
		if (primary?.canNode !== true || primary.dataType.kind !== 'color') throw new Error('Invalid primary image input');
	}
	if (graph.primaryAudioInputId != null && publicParameters.get(graph.primaryAudioInputId)?.dataType.kind !== 'audioSource') throw new Error('Invalid primary audio input');
	const customNames = new Set<string>();
	const customIds = new Set<string>();
	for (const parameter of graph.customParameterDefs) {
		if (customIds.has(parameter.id) || customNames.has(parameter.nameForReference)) throw new Error('Custom parameter ID and name must be unique');
		customIds.add(parameter.id);
		customNames.add(parameter.nameForReference);
		validateParameterDefaultValues(parameter);
		inspectStaticParameter(parameter, graph.customParameterValues[parameter.id] ?? parameter.defaultValue, (_leaf, binding) => {
			if (!isValueParameterBinding(binding) && binding.inputSource !== 'customNodeGraphEffectPublicParameterReference' && binding.inputSource !== 'customNodeGraphEffectCustomParameterValueReference') {
				throw new Error('Unsupported custom parameter binding');
			}
		});
	}

	const nodeIds = new Set(graph.nodes.map(node => node.id));
	if (nodeIds.size !== graph.nodes.length) throw new Error('Duplicate node ID');
	const definitions = new Map<string, EffectDefinition>();
	const outputs = new Map<string, ReadonlySet<string>>();
	const publicInputIds = new Set<string>(graph.paramDefs.filter(parameter => parameter.canNode && isTextureDataType(parameter.dataType)).map(parameter => parameter.id));
	let hasOutputNode = false;
	for (const node of graph.nodes) {
		switch (node.type) {
			case 'effect': {
				const definition = visit(node.effectSource, 'id' in node.effectSource ? node.effectSource.id : node.id);
				definitions.set(node.id, definition);
				outputs.set(node.id, new Set(Object.keys(definition.outputDefs)));
				break;
			}
			case 'globalIn': outputs.set(node.id, publicInputIds); break;
			case 'relay': outputs.set(node.id, new Set(['output'])); break;
			case 'globalOut':
				if (hasOutputNode) throw new Error('Multiple globalOut nodes');
				hasOutputNode = true;
				break;
		}
	}
	const dependencies = new Map<string, string[]>();
	for (const node of graph.nodes) {
		const inputs: string[] = [];
		dependencies.set(node.id, inputs);
		const addConnection = (reference: CustomNodeGraphEffectOutputConnection) => {
			if (reference.nodeId == null) return;
			if (!nodeIds.has(reference.nodeId)) throw new Error('Referenced node not found: ' + reference.nodeId);
			if (outputs.get(reference.nodeId)?.has(reference.outputPort) !== true) throw new Error('Referenced output not found: ' + reference.outputPort);
			inputs.push(reference.nodeId);
		};
		if (node.type === 'relay') addConnection(node.input);
		if (node.type === 'globalOut') {
			for (const [port, input] of Object.entries(node.inputs)) {
				if (!outputIds.has(port)) throw new Error('Unknown public output: ' + port);
				addConnection(input);
			}
		}
		if (node.type !== 'effect') continue;
		const definition = definitions.get(node.id)!;
		validateEffectResolution(node.resolution);
		validateStaticSettings(definition.staticSettingDefs ?? {}, node.staticSettings);
		for (const [key, parameter] of Object.entries(definition.paramDefs)) {
			inspectStaticParameter<CustomNodeGraphEffectParameterBinding>(parameter, node.params[key] ?? parameter.defaultValue, (leaf, binding) => {
				if (binding.inputSource === 'node') {
					if (leaf.canNode !== true) throw new Error('Parameter does not accept node input: ' + key);
					addConnection(binding);
				} else if (binding.inputSource === 'customNodeGraphEffectPublicParameterReference') {
					if (binding.parameterId === '') return; // 未選択では受け取り側の既定値を使う。
					const referencedParameter = publicParameters.get(binding.parameterId);
					if (referencedParameter == null) throw new Error('Public parameter not found: ' + binding.parameterId);
					if (!areDataTypesEqual(leaf.dataType, referencedParameter.dataType)) throw new Error('Public parameter type mismatch: ' + binding.parameterId);
					if (referencedParameter.canNode && leaf.canNode !== true) throw new Error('CPU parameter cannot read a public image input: ' + binding.parameterId);
				} else if (leaf.dataType.kind === 'audioSource') {
					validateLiteralAudioSourceBinding(binding);
				} else if (binding.inputSource !== 'customNodeGraphEffectCustomParameterValueReference' && !isValueParameterBinding(binding)) {
					throw new Error('Unsupported Custom Node Graph Effect parameter binding');
				}
			});
		}
	}
	const cycle = findDependencyCycle(dependencies);
	if (cycle != null) throw new Error('Node connection cycle: ' + cycle.join(' → '));
}
