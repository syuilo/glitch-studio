import fill from './fx/fill/_impl_.ts';
import type { CreateNativeEffectInstance } from '@gs/subsystems_effect-new_renderer/native-effect/native-effect-implementation.ts';

export const nativeEffectImplementations: ReadonlyMap<string, CreateNativeEffectInstance> = new Map([['fill', fill]]);
