import { effectDefinitions } from '@glitch/shared/effect-definitions.ts';
import { areNodeDataTypesCompatible, getNodeOutputs } from '@glitch/shared/utility/node-outputs.ts';
import type { NodeDataType } from '@glitch/shared/utility/node-outputs.ts';
import type { GsNode, NodeOutputReference } from '@glitch/shared/types.ts';
import { preferences } from '@/preferences.ts';

export function canConnectNodeDataTypes(output: NodeDataType | undefined, input: NodeDataType | null): boolean {
	if (output == null || input == null) return false;
	return !preferences.s.forceTypeSafety || areNodeDataTypesCompatible(output, input);
}

// GsSelectはプリミティブ値を比較するため、選択キーだけを文字列化する。保存する値は接続情報のまま。
export function nodeOutputKey(connection: NodeOutputReference | null): string | null {
	return connection == null ? null : JSON.stringify([connection.nodeId, connection.outputPort]);
}

export function getNodeOutputItems(nodes: GsNode[], excludedNodeId?: string, inputDataType?: NodeDataType | null): { label: string; value: string; connection: NodeOutputReference; dataType: NodeDataType; typeCompatible: boolean }[] {
	return nodes.flatMap(node => {
		if (node.id === excludedNodeId) return [];
		const name = node.type === 'effect' ? effectDefinitions[node.effectId].displayName : node.name;
		const outputs = Object.entries(getNodeOutputs(node)).filter(([, output]) => inputDataType === undefined || canConnectNodeDataTypes(output.dataType, inputDataType)).map(([outputPort, output]) => {
			const connection = { nodeId: node.id, outputPort };
			return { label: `${name} [${node.id}]: ${outputPort}`, value: nodeOutputKey(connection)!, connection, dataType: output.dataType,
				typeCompatible: inputDataType === undefined || areNodeDataTypesCompatible(output.dataType, inputDataType) };
		});
		return node.type === 'group' ? [...outputs, ...getNodeOutputItems(node.nodes, excludedNodeId, inputDataType)] : outputs;
	});
}
