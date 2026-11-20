// 素材の同一性と表示名は差し替え対象に含めず、原本の情報だけを公開Commandへ渡す。
export function assetSource(asset) {
	const { id, name, ...source } = asset;
	return source;
}

export function customNodeGraphEffectTarget(input) {
	return input.customNodeGraphEffectId != null ? { customNodeGraphEffectId: input.customNodeGraphEffectId }
		: { sceneId: input.sceneId, layerId: input.layerId };
}

export function nodeTarget(input) {
	return { customNodeGraphEffect: customNodeGraphEffectTarget(input), nodeId: input.nodeId };
}

export function nodeParameterTarget(input) {
	return { target: nodeTarget(input), parameterPath: input.paramPath };
}

export function customParameterTarget(input) {
	return { customNodeGraphEffect: customNodeGraphEffectTarget(input), parameterId: input.parameterId };
}

export function timelineParameterTarget(input) {
	return { sceneId: input.sceneId, layerId: input.layerId,
		parameterGroup: input.target ?? 'effect',
		parameterPath: input.paramPath };
}
