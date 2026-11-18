import type { NativeEffectImplementation } from '@gs/subsystems_effect-new_renderer/native-effect/native-effect-implementation.ts';
import decomposeVector from './fx/decomposeVector/_impl_.ts';

export const nativeEffectImplementations: ReadonlyMap<string, NativeEffectImplementation> = new Map([
	['decomposeVector', decomposeVector],
]);
