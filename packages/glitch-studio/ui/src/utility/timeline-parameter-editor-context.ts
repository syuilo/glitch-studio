import type { ComputedRef, InjectionKey } from 'vue';
import type { TimelineLayerCustomParameterContext } from '@gs/subsystems_timeline_shared/custom-parameters.ts';

/** Inspector内の末端エディタへ渡す。Visual Module内部のノード編集には公開しない。 */
export const timelineParameterEditorContextKey: InjectionKey<{
	context: ComputedRef<TimelineLayerCustomParameterContext | null>;
	isCustomParameterValue: boolean;
}> = Symbol('timelineParameterEditorContext');
