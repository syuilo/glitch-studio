import { startPortableNodesEffectRenderer } from './renderer.ts';
import type { NativeEffectDefinitions } from '@gs/glitch-studio_shared/project/effects.ts';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import type { PortableNodesEffectRendererConnection, PortableNodesEffectWorkerRequest } from './protocol.ts';

export function startPortableNodesEffectWorker(definitions: NativeEffectDefinitions, implementations: Readonly<Record<string, NativeEffectImplementation>>) {
	let renderer: PortableNodesEffectRendererConnection;
	globalThis.onmessage = ({ data }: MessageEvent<PortableNodesEffectWorkerRequest>) => {
		if (data.type === 'initialize') renderer = startPortableNodesEffectRenderer(data, definitions, implementations);
		else renderer.update(data);
	};
}
