// Commandを実際に動かしつつ、ポインター追跡の代わりに開始時の制約と適用関数を取得する。
// ジェスチャーの寿命・DOMとの連携はtimeline-interaction.test.mjsで別途検証する。
export function createDragActionsFixture(api, project, { selection = { kind: 'layers', ids: [] }, currentTime = 0, snapToSeekBar = false } = {}) {
	const selected = { value: selection };
	let move;
	const actions = api.createTimelineDragActions({
		stateManager: project.history, scene: project.scene,
		sceneLayers: { get value() { return api.flattenTimelineLayers(project.scene.layers); } },
		keyframeEntries: { get value() { return api.getTimelineKeyframeEntries(project.state, api.flattenTimelineLayers(project.scene.layers)); } },
		selection: selected, mediaInfo: { value: new Map() },
		viewport: { positionX: { value: 0 }, rangeX: { value: 1000 }, tickCount: { value: 5 }, ticksWithMinor: { value: [] } },
		drag: { canStart: () => true, startSelectionMove(event, points, times, apply, getSnapLines) { move = { points, times, apply, getSnapLines }; } },
		snapping: {
			settings: { value: { enabled: true, globalTicks: false, localTicks: false, seekBar: snapToSeekBar } },
			clipSettings: { value: { start: true, end: true } }, currentTime: { value: currentTime },
			tickMode: { value: 'binary' }, tickSubdivisions: { value: { halves: false, thirds: false } },
		},
		selectLayer: layer => { selected.value = { kind: 'layers', ids: [layer.id] }; },
		selectClip: target => { selected.value = { kind: 'clips', clips: [target] }; },
		selectKeyframe: point => { selected.value = { kind: 'keyframes', keyframes: [point] }; },
		revealDetails() {}, focusTimeline() {},
	});
	return { actions, selection: selected, get move() { return move; } };
}
