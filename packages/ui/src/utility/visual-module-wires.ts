import { inject, provide, reactive } from 'vue';
import type { InjectionKey } from 'vue';

type WireMap = {
	in: Record<string, Record<string, HTMLElement>>;
	out: Record<string, Record<string, HTMLElement>>;
	allIn: Record<string, HTMLElement>;
};

const wireMapKey: InjectionKey<WireMap> = Symbol('visual-module-wires');
const createWireMap = (): WireMap => reactive({ in: {}, out: {}, allIn: {} });

export function provideVisualModuleWires() {
	// 同じノードIDを含む定義を複数のパネルで開いてもDOM参照を共有しない。
	provide(wireMapKey, createWireMap());
}

export function useVisualModuleWires(): WireMap {
	// レイヤー引数など、エディタ外のパラメータコントロールでも使用する。
	return inject(wireMapKey, createWireMap, true);
}
