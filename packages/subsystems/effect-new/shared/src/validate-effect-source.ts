import { areDataTypesEqual, isTextureDataType } from '@gs/shared/data-type/data-type.ts';
import { areNodeDataTypesCompatible, getNodeInputDataType } from '@gs/shared/data-type/node-compatibility.ts';
import { prepareExpressionParameterValue } from '@gs/shared/parameter/expression-parameter-value.ts';
import { validateStaticSettings } from '@gs/shared/static-setting.ts';
import { findDependencyCycle } from '@gs/shared/utility/dependency-cycle.ts';
import { resolveEffectSource } from './effect-source.ts';
import type { CustomNodeGraphEffect, CustomNodeGraphEffectConnection } from './custom-node-graph-effect/types.ts';
import type { CustomShaderEffect } from './custom-shader-effect/types.ts';
import type { EffectDefinition, EffectParameterDefinition } from './effect-definition.ts';
import type { EffectCatalog, EffectSource, ResolvedEffectSource } from './effect-source.ts';
import type { DataType } from '@gs/shared/data-type/data-type.ts';

function validateLiteral(definition: EffectParameterDefinition, value: unknown): void {
	// 式では数値文字列や可変長ベクトルも扱えるが、保存するliteralは宣言型の表現に限定する。
	if ((definition.dataType.kind === 'any' && value !== null && !(Array.isArray(value) && value.length === 4))
		|| (definition.dataType.kind === 'scalar' && typeof value !== 'number')) {
		throw new Error(`Invalid ${definition.dataType.kind} literal: ${definition.ui.label}`);
	}
	prepareExpressionParameterValue(definition, value);
}

function validatePublicInterface(definition: EffectDefinition): void {
	if (definition.primaryInputId != null && !Object.hasOwn(definition.paramDefs, definition.primaryInputId)) {
		throw new Error(`Unknown primary input: ${definition.primaryInputId}`);
	}
	if (definition.primaryOutputId != null && !Object.hasOwn(definition.outputDefs, definition.primaryOutputId)) {
		throw new Error(`Unknown primary output: ${definition.primaryOutputId}`);
	}
	for (const parameter of Object.values(definition.paramDefs)) validateLiteral(parameter, parameter.defaultValue.value);
}

function validateShaderInterface(definition: CustomShaderEffect): void {
	if (definition.shaderApiVersion !== 1) throw new Error('Unsupported Custom Shader Effect API version');
	if (Object.keys(definition.outputDefs).length === 0) throw new Error('Custom Shader Effect requires an output');
	for (const [id, parameter] of Object.entries(definition.paramDefs)) {
		if (getNodeInputDataType(parameter) == null) throw new Error(`Custom Shader Effect requires a spatial input: ${id}`);
	}
	for (const [id, output] of Object.entries(definition.outputDefs)) {
		if (!isTextureDataType(output.dataType)) throw new Error(`Custom Shader Effect requires a spatial output: ${id}`);
	}
	// コード・参照名は編集可能。WGSL本文のコンパイルはGPUに任せ、ここでは生成する識別子の構造だけを検査する。
	for (const ports of [definition.paramDefs, definition.outputDefs]) {
		const names = new Set<string>();
		for (const { nameForReference } of Object.values(ports)) {
			if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(nameForReference) || nameForReference.includes('__') || nameForReference.startsWith('gs_')) {
				throw new Error(`Invalid Custom Shader Effect reference name: ${nameForReference}`);
			}
			if (names.has(nameForReference)) throw new Error(`Duplicate Custom Shader Effect reference name: ${nameForReference}`);
			names.add(nameForReference);
		}
	}
}

type ConnectionType = { dataType: DataType; canNode?: boolean };

function validateParameterConnection(source: ConnectionType, target: ConnectionType): void {
	// CPU値を同じ型の空間入力に渡すと、読み取る配置がliteralと同じように定数へ変換する。
	// 空間入力にはテクスチャが届く可能性があり、CPUパラメータへは戻せない。
	const isCompatible = source.canNode === true
		? areNodeDataTypesCompatible(getNodeInputDataType(source), getNodeInputDataType(target))
		: areDataTypesEqual(source.dataType, target.dataType);
	if (!isCompatible) throw new Error(`Incompatible connection: ${source.dataType.kind} → ${target.dataType.kind}`);
}

function validateGraphWiring(graph: CustomNodeGraphEffect, catalog: EffectCatalog): void {
	const nodes = new Map<string, ResolvedEffectSource>();
	for (const node of graph.nodes) {
		if (nodes.has(node.id)) throw new Error(`Duplicate node ID: ${node.id}`);
		nodes.set(node.id, resolveEffectSource(node.effectSource, catalog));
	}
	const getConnectionType = (connection: CustomNodeGraphEffectConnection): ConnectionType => {
		if (connection.inputSource === 'publicParameter') {
			if (!Object.hasOwn(graph.paramDefs, connection.parameterId)) throw new Error(`Unknown public parameter: ${connection.parameterId}`);
			return graph.paramDefs[connection.parameterId];
		}
		const definition = nodes.get(connection.nodeId)?.definition;
		if (definition == null) throw new Error(`Unknown node: ${connection.nodeId}`);
		if (!Object.hasOwn(definition.outputDefs, connection.outputPort)) throw new Error(`Unknown output: ${connection.nodeId}.${connection.outputPort}`);
		return { dataType: definition.outputDefs[connection.outputPort].dataType, canNode: true };
	};

	const dependencies = new Map<string, string[]>();
	for (const node of graph.nodes) {
		const child = nodes.get(node.id)!;
		if (node.resolution != null && ![node.resolution.width, node.resolution.height].every(value => Number.isSafeInteger(value) && value > 0)) {
			throw new Error(`Invalid node resolution: ${node.id}`);
		}
		validateStaticSettings(child.definition.staticSettingDefs ?? {}, node.staticSettings ?? {});
		const inputs: string[] = [];
		for (const [id, binding] of Object.entries(node.params)) {
			if (!Object.hasOwn(child.definition.paramDefs, id)) throw new Error(`Unknown parameter: ${node.id}.${id}`);
			const parameter = child.definition.paramDefs[id];
			if (binding.inputSource === 'literal') {
				validateLiteral(parameter, binding.value);
			} else {
				const source = getConnectionType(binding);
				validateParameterConnection(source, parameter);
				if (binding.sampling != null && (child.type === 'customNodeGraphEffect' || source.canNode !== true)) {
					throw new Error(`Sampling requires an input that reads spatial data: ${node.id}.${id}`);
				}
				if (binding.inputSource === 'node') inputs.push(binding.nodeId);
			}
		}
		dependencies.set(node.id, inputs);
	}
	for (const [id, connection] of Object.entries(graph.outputs)) {
		if (!Object.hasOwn(graph.outputDefs, id)) throw new Error(`Unknown public output: ${id}`);
		// 公開出力は借用した空間データを転送する。CPU値の変換・サンプリングを行う実装は持たない。
		const source = getConnectionType(connection);
		if (!areNodeDataTypesCompatible(getNodeInputDataType(source), graph.outputDefs[id].dataType)) {
			throw new Error(`Incompatible public output: ${id}`);
		}
	}
	const cycle = findDependencyCycle(dependencies);
	if (cycle != null) throw new Error(`Cyclic node connection: ${cycle.join(' → ')}`);
}

/** 編集・読み込み時に、未配線のノードも含めて検査する。描画中にはグラフを再検証しない。 */
export function validateEffectSource(source: EffectSource, catalog: EffectCatalog): void {
	const complete = new Set<EffectDefinition>();
	const active = new Map<CustomNodeGraphEffect, string>();
	const visit = (target: EffectSource, placement: string): void => {
		const resolved = resolveEffectSource(target, catalog);
		if (resolved.type === 'nativeEffect' || complete.has(resolved.definition)) return;
		validatePublicInterface(resolved.definition);
		if (resolved.type === 'customShaderEffect') {
			validateShaderInterface(resolved.definition);
		} else {
			// 登録定義とインライン定義が混ざる経路も同じ探索で追う。
			// 探索中の経路への再入だけが循環で、兄弟から同じ定義を使うことは許可する。
			const label = target.type === 'customNodeGraphEffectReference' ? target.id : placement;
			if (active.has(resolved.definition)) {
				const path = [...active.values(), label];
				throw new Error(`Cyclic Custom Node Graph Effect reference: ${path.join(' → ')}`);
			}
			active.set(resolved.definition, label);
			validateGraphWiring(resolved.definition, catalog);
			for (const node of resolved.definition.nodes) visit(node.effectSource, node.id);
			active.delete(resolved.definition);
		}
		complete.add(resolved.definition);
	};
	visit(source, 'inline');
}
