import solidColor from './solidColor/_def_.ts';
import type { NativeEffectDefinition } from './native-effect-definition.ts';

/** 実装は読み込まず、組み込み定義のIDからrenderer側の実装一覧にも必要なキーを導く。 */
export const nativeEffectDefinitions = {
	[solidColor.id]: solidColor,
} as const satisfies Record<string, NativeEffectDefinition>;

export type NativeEffectId = keyof typeof nativeEffectDefinitions;

export function getNativeEffectId(id: string): NativeEffectId {
	if (!Object.hasOwn(nativeEffectDefinitions, id)) throw new Error(`Unknown Native Effect: ${id}`);
	return id as NativeEffectId;
}
