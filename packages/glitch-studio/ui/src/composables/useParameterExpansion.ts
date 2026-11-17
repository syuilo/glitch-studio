import { computed, inject, ref } from 'vue';
import type { ComputedRef, InjectionKey } from 'vue';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import { isParameterType } from '@gs/shared/parameter/parameter-definition.ts';
import type { ParamPath } from '@gs/shared/parameter/parameter-path.ts';
import type { ProjectSessionContext } from '@/ProjectSessionContext.ts';

// 開閉はプレビューの再生・操作可否に依存しない。編集対象の所有者だけを上位UIから受け取る。
export const parameterExpansionScopeKey: InjectionKey<ComputedRef<string | null>> = Symbol('parameter-expansion-scope');

export function useParameterExpansion(session: Pick<ProjectSessionContext, 'parameterExpansionStates'>, props: {
	paramDef: ParameterDefinition;
	paramPath: ParamPath;
	node?: { id: string };
	previewParameterGroup?: string;
}) {
	return useParameterExpansionState(session,
		() => [props.node?.id ?? null, props.previewParameterGroup ?? null, props.paramPath],
		() => isParameterType(props.paramDef, 'struct') || isParameterType(props.paramDef, 'array')
			? props.paramDef.ui.control.defaultExpanded ?? true : true);
}

// パラメータパスと表示用セクションIDは別の識別子として保持し、
// 開閉状態の保存先と、スコープがない場合のローカル保持だけを共有する。
export function useParameterExpansionState(session: Pick<ProjectSessionContext, 'parameterExpansionStates'>, identity: () => readonly unknown[], defaultExpanded: () => boolean) {
	const scope = inject(parameterExpansionScopeKey, null);
	const localExpanded = ref<boolean | null>(null);
	const stateKey = computed(() => scope?.value == null ? null
		: JSON.stringify([scope.value, ...identity()]));
	return computed({
		get() {
			return (stateKey.value == null ? localExpanded.value : session.parameterExpansionStates.get(stateKey.value)) ?? defaultExpanded();
		},
		set(expanded: boolean) {
			if (stateKey.value == null) localExpanded.value = expanded;
			else session.parameterExpansionStates.set(stateKey.value, expanded);
		},
	});
}
