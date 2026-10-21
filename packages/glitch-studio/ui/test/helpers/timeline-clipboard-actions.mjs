import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// 実際のDOMイベント処理とCommandを接続し、入力欄の標準動作を奪わないことも確認する。
const bundled = await build({ entryPoints: [fileURLToPath(new URL('../../src/utility/editor-edit-events.ts', import.meta.url))],
	bundle: true, platform: 'node', format: 'cjs', write: false });

export function createTimelineClipboardHandlers(api, context) {
	let disposed = context.disposed ?? false;
	const scene = context.editedScene;
	const actions = api.createTimelineSelectionEditActions({
		stateManager: context.stateManager, scene,
		sceneLayers: context.sceneLayers ?? { get value() { return api.flattenTimelineLayers(scene.layers); } },
		selection: context.selection, selectedLayer: context.selectedLayer, clipboard: context.timelineClipboard,
		currentTime: context.time,
		isActive: () => !disposed && context.stateManager.state.timelineScenes.value.find(entry => entry.id === scene.id) === scene,
		inspectMedia: context.inspectTimelineClipMedia,
		readLayerMediaDurations: context.readLayerMediaDurations,
		selectLayer: context.selectLayer,
		focusTimeline: () => context.tlEl.value?.focus({ preventScroll: true }),
		reportError: error => {
			console.error(error);
			context.ui.alert({ type: 'error', text: error instanceof Error ? error.message : String(error) });
		},
	});
	const module = { exports: {} };
	new Function('module', 'exports', 'window', 'HTMLElement', bundled.outputFiles[0].text)(module, module.exports,
		{ document: { getSelection: () => null } }, context.HTMLElement);
	const events = module.exports.createEditorEditEventHandlers(actions);
	return {
		...events,
		actions,
		pasteClips(content) { context.timelineClipboard.value = content; return actions.paste(); },
		dispose: () => { disposed = true; },
	};
}
