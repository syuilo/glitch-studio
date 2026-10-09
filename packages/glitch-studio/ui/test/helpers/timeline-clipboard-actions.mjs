import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import { parse } from 'vue/compiler-sfc';
import { createSourceFile, isFunctionDeclaration, ScriptTarget } from 'typescript';

// コピー・貼り付けの実装は直接importし、SFCからはキー入力の振り分けだけを取り出す。
// Ctrl/Cmd・入力欄・リピートの扱いと、実際のCommandによる変更を同時に確認する。
const source = await readFile(new URL('../../src/components/GsTimeline.vue', import.meta.url), 'utf8');
const ast = createSourceFile('GsTimeline.ts', parse(source).descriptor.scriptSetup.content, ScriptTarget.Latest);
const handler = ast.statements.find(statement => isFunctionDeclaration(statement) && statement.name?.text === 'onTlKeydown');
assert.ok(handler);
const transformed = await transform(handler.getText(ast), { loader: 'ts' });
const createKeydown = new Function('context', `
	const { HTMLElement, selection, clipboardActions, onCueKeyboardDown, removeSelectedKeyframes, removeSelectedClips } = context;
	${transformed.code}
	return onTlKeydown;
`);

export function createTimelineClipboardHandlers(api, context) {
	let disposed = context.disposed ?? false;
	const scene = context.editedScene;
	const actions = api.createTimelineClipboardActions({
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
	return {
		actions,
		onTlKeydown: createKeydown({ ...context, clipboardActions: actions }),
		pasteClips(content) { context.timelineClipboard.value = content; return actions.paste(); },
		dispose: () => { disposed = true; },
	};
}
