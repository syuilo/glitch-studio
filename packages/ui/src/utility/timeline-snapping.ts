export type TimelineSnapSettings = {
	enabled: boolean;
	globalTicks: boolean;
	localTicks: boolean;
};

/** 目盛り以外の候補は全体スイッチだけに従う。クリップ操作ではlocalTicksを渡さない。 */
export function getTimelineSnapCandidates(settings: TimelineSnapSettings, otherTimes: number[], globalTicks: number[], localTicks: number[] = []): number[] {
	if (!settings.enabled) return [];
	return [...new Set([
		...otherTimes,
		...(settings.globalTicks ? globalTicks : []),
		...(settings.localTicks ? localTicks : []),
	])];
}
