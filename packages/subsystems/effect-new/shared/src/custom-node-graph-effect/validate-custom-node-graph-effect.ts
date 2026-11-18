import { areDataTypesEqual } from '@gs/shared/data-type/data-type.ts';
import { areNodeDataTypesCompatible, getNodeInputDataType } from '@gs/shared/data-type/node-compatibility.ts';
import { inspectStaticParameter } from '@gs/shared/parameter/static-parameter.ts';
import { validateStaticSettings } from '@gs/shared/static-setting.ts';
import { findDependencyCycle } from '@gs/shared/utility/dependency-cycle.ts';
import type { DataType } from '@gs/shared/data-type/data-type.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { EffectDefinition } from '../effect-definition.ts';
import type { CustomNodeGraphEffect, CustomNodeGraphEffectConnection, CustomNodeGraphEffectParameterBinding } from './custom-node-graph-effect.ts';

type ConnectionEndpoint = { dataType: DataType; canNode?: boolean };

function validateConnection(source: ConnectionEndpoint, input: ConnectionEndpoint, location: string): void {
	if (source.canNode === true) {
		if (!areNodeDataTypesCompatible(getNodeInputDataType(source), getNodeInputDataType(input))) {
			throw new Error(`Incompatible texture connection: ${location}`);
		}
	} else if (!areDataTypesEqual(source.dataType, input.dataType)) {
		throw new Error(`Incompatible public parameter: ${location}`);
	}
}

/** 定義間の参照を解決した後、1つのCustom Node Graph Effect内部の配線を検査する。 */
export function validateCustomNodeGraphEffectConnections(customNodeGraphEffect: CustomNodeGraphEffect, nodeDefinitions: ReadonlyMap<string, EffectDefinition>): void {
	const getEndpoint = (connection: CustomNodeGraphEffectConnection): ConnectionEndpoint => {
		if (connection.inputSource === 'publicParameter') {
			if (!Object.hasOwn(customNodeGraphEffect.paramDefs, connection.parameterId)) throw new Error(`Unknown public parameter: ${connection.parameterId}`);
			return customNodeGraphEffect.paramDefs[connection.parameterId];
		}
		const definition = nodeDefinitions.get(connection.nodeId);
		if (definition == null) throw new Error(`Unknown node: ${connection.nodeId}`);
		if (!Object.hasOwn(definition.outputDefs, connection.outputPort)) throw new Error(`Unknown output: ${connection.nodeId}.${connection.outputPort}`);
		return { dataType: definition.outputDefs[connection.outputPort].dataType, canNode: true };
	};

	const dependencies = new Map<string, string[]>();
	for (const node of customNodeGraphEffect.nodes) {
		const definition = nodeDefinitions.get(node.id)!;
		const inputs: string[] = [];
		dependencies.set(node.id, inputs);
		if (node.resolution != null && ![node.resolution.width, node.resolution.height].every(size => Number.isSafeInteger(size) && size > 0)) {
			throw new Error(`Invalid node resolution: ${node.id}`);
		}
		validateStaticSettings(definition.staticSettingDefs ?? {}, node.staticSettings ?? {});
		for (const key of Object.keys(node.params)) {
			if (!Object.hasOwn(definition.paramDefs, key)) throw new Error(`Unknown parameter: ${node.id}.${key}`);
		}
		for (const [id, parameter] of Object.entries(definition.paramDefs)) {
			const binding = Object.hasOwn(node.params, id) ? node.params[id] : parameter.defaultValue;
			inspectStaticParameter<CustomNodeGraphEffectParameterBinding | ValueParameterBinding>(parameter, binding, (leaf, input) => {
				if ('expressionModifier' in input && input.expressionModifier != null) throw new Error(`Unsupported expression modifier: ${node.id}.${id}`);
				if (input.inputSource === 'literal') return;
				// 式のスコープを所有しない配置で、既定値の子に含まれる式を暗黙に評価しない。
				if (input.inputSource !== 'node' && input.inputSource !== 'publicParameter') throw new Error(`Unsupported parameter binding: ${node.id}.${id}`);
				validateConnection(getEndpoint(input), leaf, `${node.id}.${id}`);
				if (input.inputSource === 'node') inputs.push(input.nodeId);
			});
		}
	}
	const cycle = findDependencyCycle(dependencies);
	if (cycle != null) throw new Error(`Custom Node Graph Effect wiring cycle: ${cycle.join(' → ')}`);
	for (const [id, connection] of Object.entries(customNodeGraphEffect.outputs)) {
		if (!Object.hasOwn(customNodeGraphEffect.outputDefs, id)) throw new Error(`Unknown public output: ${id}`);
		const source = getEndpoint(connection);
		if (!areNodeDataTypesCompatible(getNodeInputDataType(source), customNodeGraphEffect.outputDefs[id].dataType)) {
			throw new Error(`Incompatible public output: ${id}`);
		}
	}
}
