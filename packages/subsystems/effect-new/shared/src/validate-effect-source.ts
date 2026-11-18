import { getNodeInputDataType } from '@gs/shared/data-type/node-compatibility.ts';
import { validateCustomNodeGraphEffectConnections } from './custom-node-graph-effect/validate-custom-node-graph-effect.ts';
import { resolveEffectSource } from './effect-source.ts';
import type { CustomNodeGraphEffect } from './custom-node-graph-effect/custom-node-graph-effect.ts';
import type { CustomShaderEffect } from './custom-shader-effect/custom-shader-effect.ts';
import type { EffectDefinition } from './effect-definition.ts';
import type { EffectCatalog, EffectSource } from './effect-source.ts';

function validatePublicPorts(definition: EffectDefinition): void {
	const { primaryInputParameter, primaryAudioInputParameter, primaryOutput, resolutionInputParameters } = definition;
	if (primaryInputParameter != null && (!Object.hasOwn(definition.paramDefs, primaryInputParameter) || getNodeInputDataType(definition.paramDefs[primaryInputParameter]) == null)) {
		throw new Error(`Invalid primary input: ${primaryInputParameter}`);
	}
	if (primaryAudioInputParameter != null && (!Object.hasOwn(definition.paramDefs, primaryAudioInputParameter) || definition.paramDefs[primaryAudioInputParameter].dataType.kind !== 'audioSource')) {
		throw new Error(`Invalid primary audio input: ${primaryAudioInputParameter}`);
	}
	if (primaryOutput != null && !Object.hasOwn(definition.outputDefs, primaryOutput)) throw new Error(`Unknown primary output: ${primaryOutput}`);
	for (const id of resolutionInputParameters) {
		if (!Object.hasOwn(definition.paramDefs, id)) throw new Error(`Unknown resolution input: ${id}`);
	}
}

function validateShaderNames(ports: Readonly<Record<string, { nameForReference: string }>>): void {
	const names = new Set<string>();
	for (const { nameForReference } of Object.values(ports)) {
		if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(nameForReference) || nameForReference.includes('__') || nameForReference.startsWith('gs_')) {
			throw new Error(`Invalid WGSL reference name: ${nameForReference}`);
		}
		if (names.has(nameForReference)) throw new Error(`Duplicate WGSL reference name: ${nameForReference}`);
		names.add(nameForReference);
	}
}

function validateCustomShaderEffect(customShaderEffect: CustomShaderEffect): void {
	if (customShaderEffect.codeLanguage !== 'wgsl' || customShaderEffect.shaderApiVersion !== 1) throw new Error('Unsupported Custom Shader Effect API');
	if (Object.keys(customShaderEffect.outputDefs).length === 0) throw new Error('Custom Shader Effect requires at least one output');
	validateShaderNames(customShaderEffect.paramDefs);
	validateShaderNames(customShaderEffect.outputDefs);
}

/** 編集・読み込み時の入口。未接続の配置も検査し、検証済み定義を描画側へ渡す。 */
export function validateEffectSource(source: EffectSource, catalog: EffectCatalog): void {
	const checked = new Set<EffectDefinition>();
	const active = new Map<CustomNodeGraphEffect, string>();
	const visit = (current: EffectSource, location: string): EffectDefinition => {
		const resolved = resolveEffectSource(current, catalog);
		const { definition } = resolved;
		if (resolved.type === 'nativeEffect' || checked.has(definition)) return definition;
		validatePublicPorts(definition);
		if (resolved.type === 'customShaderEffect') {
			validateCustomShaderEffect(resolved.definition);
		} else {
			const customNodeGraphEffect = resolved.definition;
			// 同じ登録定義の別配置は合法。現在の参照経路へ戻った場合だけ循環になる。
			const name = current.type === 'customNodeGraphEffectReference' ? current.id : location;
			if (active.has(customNodeGraphEffect)) {
				throw new Error(`Custom Node Graph Effect reference cycle: ${[...active.values(), name].join(' → ')}`);
			}
			active.set(customNodeGraphEffect, name);
			const nodeDefinitions = new Map<string, EffectDefinition>();
			for (const node of customNodeGraphEffect.nodes) {
				if (nodeDefinitions.has(node.id)) throw new Error(`Duplicate node ID: ${node.id}`);
				nodeDefinitions.set(node.id, visit(node.effectSource, node.id));
			}
			validateCustomNodeGraphEffectConnections(customNodeGraphEffect, nodeDefinitions);
			active.delete(customNodeGraphEffect);
		}
		checked.add(definition);
		return definition;
	};
	visit(source, 'inline');
}
