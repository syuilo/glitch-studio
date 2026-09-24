import type { layerEnvVarDefs, moduleEnvVarDefs } from '@glitch/shared/expression.js';

export function layerVariables(context: { isExport: boolean }) {
	return {
		TEST_ONLY_LAYER: true,
		TEST_SAME_NAME: 2,
		IS_EXPORT: context.isExport,
	} satisfies Record<typeof layerEnvVarDefs[number], unknown>;
}

export function moduleVariables(context: { time: number; endTime: number; isExport: boolean; resolution: { width: number; height: number } }) {
	return {
		WIDTH: context.resolution.width,
		HEIGHT: context.resolution.height,
		TIME: context.time / 1000, TIME_MS: context.time,
		END_TIME: context.endTime / 1000, END_TIME_MS: context.endTime,
		PROGRESS: context.time / context.endTime, IS_EXPORT: context.isExport,
		TEST_ONLY_VM: true, TEST_SAME_NAME: 1,
	} satisfies Record<typeof moduleEnvVarDefs[number], unknown>;
}
