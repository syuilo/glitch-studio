import type { EffectSource } from '@gs/subsystems_effect_shared/effect-source.ts';
import type { EffectLivePreviewPlacement } from '@gs/glitch-studio_renderer/effect-live-preview-manager.ts';

export type EffectLivePreviewSource = Extract<EffectSource, { type: 'nodesEffectReference' | 'customShaderEffectReference' }>;
export type EffectLivePreviewParamValues = NonNullable<EffectLivePreviewPlacement['params']>;
export type EffectLivePreviewMediaSelection =
	| { kind: 'asset'; assetId: string | null }
	| { kind: 'webcam' | 'microphone'; deviceId: string | null };

export const defaultPreviewDeviceId = 'default';
