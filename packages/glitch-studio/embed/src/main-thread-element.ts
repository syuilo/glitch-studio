import { registerNodesEffectElement } from './element.ts';
import { startPortableNodesEffectRenderer } from './renderer.ts';
import type { PortableNodesEffect } from '@gs/glitch-studio_shared/portable-nodes-effect.ts';
import type { NativeEffectDefinitions } from '@gs/glitch-studio_shared/project/effects.ts';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';

export function registerMainThreadNodesEffectElement(tagName: string, artwork: PortableNodesEffect, artworkModuleUrl: string | null,
	definitions: NativeEffectDefinitions, implementations: Readonly<Record<string, NativeEffectImplementation>>) {
	registerNodesEffectElement(tagName, artwork, artworkModuleUrl,
		initialization => startPortableNodesEffectRenderer(initialization, definitions, implementations));
}
