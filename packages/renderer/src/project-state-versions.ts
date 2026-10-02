import { visualModuleTargetKey } from '@glitch/shared/project/renderer-state.ts';
import type { RendererProjectChange, VisualModuleTarget } from '@glitch/shared/project/renderer-state.ts';

/** 定義の変更だけを数える。描画回数やGPUリソースの世代とは独立して扱う。 */
export class ProjectStateVersions {
	private revision = 0;
	private modules = new Map<string, { revision: number; cacheResetRevision: number }>();
	private layers = new Map<string, number>();
	private scenes = new Map<string, number>();

	module(target: VisualModuleTarget) {
		return this.modules.get(visualModuleTargetKey(target)) ?? { revision: 0, cacheResetRevision: 0 };
	}

	scene(id: string) { return this.scenes.get(id) ?? 0; }
	layer(sceneId: string, layerId: string) { return this.layers.get(JSON.stringify([sceneId, layerId])) ?? 0; }

	apply(changes: readonly RendererProjectChange[]) {
		const revision = ++this.revision;
		for (const change of changes) {
			if (change.type === 'node' || change.type === 'visualModule') {
				const previous = this.module(change.target);
				this.modules.set(visualModuleTargetKey(change.target), { revision,
					cacheResetRevision: change.type === 'node' && change.preserveCache ? previous.cacheResetRevision : revision });
			} else if (change.type === 'layer' && !change.preserveModuleInstance) {
				this.layers.set(JSON.stringify([change.sceneId, change.layerId]), revision);
			} else if (change.type === 'scene') {
				this.scenes.set(change.sceneId, revision);
			}
		}
	}
}
