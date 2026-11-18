import fill from './fx/fill/_def_.ts';
import type { NativeEffectDefinition } from '@gs/subsystems_effect-new_shared/effect-definition.ts';

export const nativeEffectDefinitions: ReadonlyMap<string, NativeEffectDefinition> = new Map([[fill.id, fill]]);
