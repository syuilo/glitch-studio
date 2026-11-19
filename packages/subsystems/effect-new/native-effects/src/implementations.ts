import fill from './fx/fill/_impl_.ts';
import type { NativeEffectImplementation } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';

export const nativeEffectImplementations = { fill } satisfies Record<string, NativeEffectImplementation>;
