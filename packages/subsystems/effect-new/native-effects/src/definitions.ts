import decomposeVector from './fx/decomposeVector/_def_.ts';
import type { NativeEffectDefinition } from './native-effect-definition.ts';

export type { NativeEffectDefinition } from './native-effect-definition.ts';

export const nativeEffectDefinitions: ReadonlyMap<string, NativeEffectDefinition> = new Map([
	['decomposeVector', decomposeVector],
]);
