import { areNodeDataTypesCompatible, getNodeOutputs } from '@glitch/shared/utility/node-outputs.ts';
import { effectDefinitions } from '@glitch/shared/effect/effect-definitions.js';
import type { TextureDataType } from '@glitch/shared/data-type.ts';
import type { VisualModuleNode, NodeOutputReference, VisualModule } from '@glitch/shared/visual-module/types.ts';
import { preferences } from '@/preferences.ts';

export function getNodeDataTypeColor(dataType: TextureDataType | null | undefined): string {
	return `var(--THEME-dataType-${dataType ?? 'any'})`;
}

export function canConnectNodeDataTypes(output: TextureDataType | undefined, input: TextureDataType | null): boolean {
	if (output == null || input == null) return false;
	return !preferences.s.forceTypeSafety || areNodeDataTypesCompatible(output, input);
}

// GsSelectはプリミティブ値を比較するため、選択キーだけを文字列化する。保存する値は接続情報のまま。
export function nodeOutputKey(connection: { nodeId: string; outputPort: string } | null): string | null {
	return connection == null ? null : JSON.stringify([connection.nodeId, connection.outputPort]);
}

// 接続済みの警告は、forceTypeSafetyによる候補の絞り込みとは独立して判定する。
export function hasNodeInputTypeMismatch(nodes: VisualModuleNode[], connection: { nodeId: string; outputPort: string } | null, inputDataType: TextureDataType | null, paramDefs: VisualModule['paramDefs'] = []): boolean {
	if (connection == null || inputDataType == null) return false;
	return nodes.some(node => {
		if (node.id === connection.nodeId) {
			const output = getNodeOutputs(node, paramDefs)[connection.outputPort];
			return output != null && !areNodeDataTypesCompatible(output.dataType, inputDataType);
		}
		return false;
	});
}

export function getNodeOutputItems(nodes: VisualModuleNode[], excludedNodeId?: string, inputDataType?: TextureDataType | null, paramDefs: VisualModule['paramDefs'] = []): { label: string; value: string; connection: NodeOutputReference; dataType: TextureDataType; typeCompatible: boolean; icon?: string }[] {
	return nodes.flatMap(node => {
		if (node.id === excludedNodeId) return [];
		const name = node.type === 'effect' ? effectDefinitions[node.effectId].displayName : node.type === 'globalIn' ? 'In' : 'Out';
		const outputs = Object.entries(getNodeOutputs(node, paramDefs)).filter(([, output]) => inputDataType === undefined || canConnectNodeDataTypes(output.dataType, inputDataType)).map(([outputPort, output]) => {
			const connection: NodeOutputReference = { nodeId: node.id, outputPort, fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' };
			const typeCompatible = inputDataType === undefined || areNodeDataTypesCompatible(output.dataType, inputDataType);
			return {
				label: `${name} [${node.id}]: ${node.type === 'globalIn' ? paramDefs.find(def => def.id === outputPort)?.ui.label ?? outputPort : outputPort}`,
				value: nodeOutputKey(connection)!,
				connection,
				dataType: output.dataType,
				typeCompatible,
				icon: typeCompatible ? undefined : 'ti ti-alert-triangle',
			};
		});
		return outputs;
	});
}
