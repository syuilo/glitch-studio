import { inject, provide, reactive } from 'vue';
import type { InjectionKey } from 'vue';
import { paramPathKey } from '@gs/shared/parameter/parameter-path.ts';
import type { ParamPath } from '@gs/shared/parameter/parameter-path.ts';

type WireMap = {
	in: Record<string, Record<string, HTMLElement>>;
	out: Record<string, Record<string, HTMLElement>>;
	allIn: Record<string, HTMLElement>;
	collapsedParameters: Record<string, Record<string, HTMLElement>>;
};

const wireMapKey: InjectionKey<WireMap> = Symbol('visual-module-wires');
const createWireMap = (): WireMap => reactive({ in: {}, out: {}, allIn: {}, collapsedParameters: {} });

export function getVisualModuleWireInputElements(wireMap: WireMap, nodeId: string, path: ParamPath): HTMLElement[] {
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
	const allIn = wireMap.allIn[nodeId];
	if (allIn != null) elements.push(allIn);
	return elements;
}

export function provideVisualModuleWires() {
	// 同じノードIDを含む定義を複数のパネルで開いてもDOM参照を共有しない。
	const wireMap = createWireMap();
	provide(wireMapKey, wireMap);
	return wireMap;
}

export function useVisualModuleWires(): WireMap {
	// レイヤー引数など、エディタ外のパラメータコントロールでも使用する。
	return inject(wireMapKey, createWireMap, true);
}
