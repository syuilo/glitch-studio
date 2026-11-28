import { registerNodesEffectElement } from './element.ts';
import type { PortableNodesEffect } from '@gs/glitch-studio_shared/portable-nodes-effect.ts';
import type { PortableNodesEffectWorkerRequest } from './protocol.ts';

export function registerWorkerNodesEffectElement(tagName: string, artwork: PortableNodesEffect, artworkModuleUrl: string | null, workerSource: string) {
	registerNodesEffectElement(tagName, artwork, artworkModuleUrl, initialization => {
		const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
		const worker = new Worker(workerUrl, { name: tagName });
		worker.postMessage({ type: 'initialize', ...initialization } satisfies PortableNodesEffectWorkerRequest, [initialization.canvas]);
		return {
			update: change => worker.postMessage(change),
			dispose() {
				// Workerごと終了することで、処理中の初期化や描画も打ち切る。
				worker.terminate();
				URL.revokeObjectURL(workerUrl);
			},
		};
	});
}
