// 素材の同一性と表示名は差し替え対象に含めず、原本の情報だけを公開Commandへ渡す。
export function assetSource(asset) {
	const { id, name, ...source } = asset;
	return source;
}

export function visualModuleTarget(input) {
	return input.visualModuleId != null ? { visualModuleId: input.visualModuleId }
		: { sceneId: input.sceneId, inlineVisualModuleLayerId: input.inlineVisualModuleLayerId };
}

export function nodeTarget(input) {
	return { visualModule: visualModuleTarget(input), nodeId: input.nodeId };
}

export function nodeParameterTarget(input) {
	return { target: nodeTarget(input), parameterPath: input.paramPath };
}

export function customParameterTarget(input) {
	return { visualModule: visualModuleTarget(input), parameterId: input.parameterId };
}

export function timelineParameterTarget(input) {
	return { sceneId: input.sceneId, layerId: input.layerId,
		parameterGroup: input.target == null || input.target === 'module' ? 'visualModule' : input.target,
		parameterPath: input.paramPath };
}
