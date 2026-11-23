import { inject, provide, reactive } from 'vue';
import type { ComputedRef, InjectionKey } from 'vue';
import { paramPathKey } from '@gs/shared/parameter/parameter-path.ts';
import type { ParamPath } from '@gs/shared/parameter/parameter-path.ts';

type WireMap = {
	in: Record<string, Record<string, HTMLElement>>;
	out: Record<string, Record<string, HTMLElement>>;
	allIn: Record<string, HTMLElement>;
	collapsedParameters: Record<string, Record<string, HTMLElement>>;
	collapsedSections: Record<string, Record<string, { element: HTMLElement; parameterKeys: readonly string[]; depth: number }>>;
};

const wireMapKey: InjectionKey<WireMap> = Symbol('nodes-effect-wires');
// 接続済みの末端だけでなく祖先のパスも含め、ノードと各コンテナの仮想ポートで共有する。
export const connectedNodeParameterPathKeysKey: InjectionKey<ComputedRef<ReadonlySet<string>>> = Symbol('connected-node-parameter-path-keys');
const createWireMap = (): WireMap => reactive({ in: {}, out: {}, allIn: {}, collapsedParameters: {}, collapsedSections: {} });

export function getNodesEffectWireInputElements(wireMap: WireMap, nodeId: string, path: ParamPath): HTMLElement[] {
	const elements: HTMLElement[] = [];
	const input = wireMap.in[nodeId]?.[paramPathKey(path)];
	if (input != null) elements.push(input);
	// 内側の見出しも親の折り畳みで隠れるため、近い祖先から順に測定する。
	// 実際に表示されている最初のアンカーを使い、最後にノード全体の集約先へ戻る。
	for (let length = path.length - 1; length > 0; length--) {
		const ancestorPath: ParamPath = [path[0], ...path.slice(1, length)];
		const element = wireMap.collapsedParameters[nodeId]?.[paramPathKey(ancestorPath)];
		if (element != null) elements.push(element);
	}
	// セクションは値のパスに含まれない。トップレベルの所属で候補を探し、
	// struct・arrayの祖先に続いて、表示上の内側から外側へ測定する。
	const sections = Object.values(wireMap.collapsedSections[nodeId] ?? {})
		.filter(section => section.parameterKeys.includes(path[0]))
		.sort((left, right) => right.depth - left.depth);
	for (const section of sections) elements.push(section.element);
	const allIn = wireMap.allIn[nodeId];
	if (allIn != null) elements.push(allIn);
	return elements;
}

export function provideNodesEffectWires() {
	// 同じノードIDを含む定義を複数のパネルで開いてもDOM参照を共有しない。
	const wireMap = createWireMap();
	provide(wireMapKey, wireMap);
	return wireMap;
}

export function useNodesEffectWires(): WireMap {
	// レイヤー引数など、エディタ外のパラメータコントロールでも使用する。
	return inject(wireMapKey, createWireMap, true);
}
