import { effectDefinitions } from '@glitch/shared/effect-definitions.ts';
import { getNodeOutputs } from '@glitch/shared/utility/node-outputs.ts';
import type { GsNode, NodeOutputReference } from '@glitch/shared/types.ts';

// GsSelectはプリミティブ値を比較するため、選択キーだけを文字列化する。保存する値は接続情報のまま。
export function nodeOutputKey(connection: NodeOutputReference | null): string | null {
	return connection == null ? null : JSON.stringify([connection.nodeId, connection.outputPort]);
}

export function getNodeOutputItems(nodes: GsNode[], excludedNodeId?: string): { label: string; value: string; connection: NodeOutputReference }[] {
	return nodes.flatMap(node => {
		if (node.id === excludedNodeId) return [];
		const name = node.type === 'effect' ? effectDefinitions[node.effectId].displayName : node.name;
		const outputs = Object.keys(getNodeOutputs(node)).map(outputPort => {
			const connection = { nodeId: node.id, outputPort };
			return { label: `${name} [${node.id}]: ${outputPort}`, value: nodeOutputKey(connection)!, connection };
		});
		return node.type === 'group' ? [...outputs, ...getNodeOutputItems(node.nodes, excludedNodeId)] : outputs;
	});
}
