import type { NativeEffectDefinition } from './native-effect-definition.ts';
import fill from './fx/fill/_def_.ts';

export const nativeEffectDefinitions: ReadonlyMap<string, NativeEffectDefinition> = new Map([
	[fill.id, fill],
]);
