import feedback from './fx/feedback/_impl_.ts';
import fill from './fx/fill/_impl_.ts';
import vignette from './fx/vignette/_impl_.ts';
import type { NativeEffectImplementation } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';

export const nativeEffectImplementations = { feedback, fill, vignette } satisfies Record<string, NativeEffectImplementation>;
