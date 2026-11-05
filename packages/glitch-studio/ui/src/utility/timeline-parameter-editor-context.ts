import type { ComputedRef, InjectionKey } from 'vue';
import type { TimelineLayerPublicParameterContext } from '@gs/subsystems_timeline_shared/public-parameters.ts';

/** Inspector内の末端エディタへ渡す。Visual Module内部のノード編集には公開しない。 */
export const timelineParameterEditorContextKey: InjectionKey<{
	context: ComputedRef<TimelineLayerPublicParameterContext | null>;
	isPublicParameterValue: boolean;
}> = Symbol('timelineParameterEditorContext');
