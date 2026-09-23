import type { NodeOutput } from './node-output.ts';
import type { TimelineVisualModuleLayer, VisualModule } from '@glitch/shared/types.ts';
import type { VisualModuleRenderContext } from './visual-module-renderer.ts';
import type { TimelineLayerContext, TimelineLayerRenderer } from './timeline-renderer.ts';

// 主入力の割り当てやパラメータはVisual Moduleレイヤーだけの責務とする。
export function createVisualModuleTimelineLayer(
	visualModule: Pick<VisualModule, 'paramDefs'>,
	layer: TimelineVisualModuleLayer,
	renderer: {
		prepare: (context: VisualModuleRenderContext, signal: AbortSignal) => Promise<void>;
		render: (context: VisualModuleRenderContext, layerContext: TimelineLayerContext<NodeOutput>) => ReturnType<TimelineLayerRenderer<NodeOutput>['render']>;
		destroy: () => void;
	},
): TimelineLayerRenderer<NodeOutput> {
	// prepareとrenderは同じオブジェクトを渡し、評価結果を再利用する。
	// 並行するシークのコンテキストを上書きしないよう、入力ごとに保持する。
	const contexts = new WeakMap<TimelineLayerContext<NodeOutput>, VisualModuleRenderContext>();
	const resolveContext = (context: TimelineLayerContext<NodeOutput>): VisualModuleRenderContext => {
		let resolved = contexts.get(context);
		if (resolved == null) {
			resolved = {
				isExport: context.isExport,
				time: context.time,
				timeDelta: context.timeDelta,
				endTime: context.endTime,
				paramValues: layer.paramValues,
				paramInputs: new Map(visualModule.paramDefs.filter(def => def.isPrimaryInput).map(def => [def.id, context.input])),
				pointerPosition: { x: -99999, y: -99999 },
				pointerPositionPrev: { x: -99999, y: -99999 },
			};
			contexts.set(context, resolved);
		}
		return resolved;
	};
	return {
		prepare: (context, signal) => renderer.prepare(resolveContext(context), signal),
		render: context => renderer.render(resolveContext(context), context),
		destroy: () => renderer.destroy(),
	};
}
