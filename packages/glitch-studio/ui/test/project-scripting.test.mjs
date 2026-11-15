import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createTestProject } from './helpers/project.mjs';

const directory = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({
	absWorkingDir: directory, bundle: true, platform: 'node', format: 'cjs', write: false,
	define: { _VERSION_: '"test"' },
	stdin: { resolveDir: directory, loader: 'ts', contents: [
		"export { ProjectContext } from './src/Project.ts';",
		"export { ProjectScriptingController } from './src/scripting/ProjectScriptingController.ts';",
		"export { createProjectVisualModule } from './src/utility/project-visual-module.ts';",
	].join('\n') },
	plugins: [{ name: 'scripting-platform', setup(builder) {
		builder.onResolve({ filter: /preferences\.ts$|effect-definitions\.[jt]s$/ }, ({ path }) => ({ path, namespace: 'scripting-platform' }));
		builder.onLoad({ filter: /.*/, namespace: 'scripting-platform' }, ({ path }) => ({
			loader: 'ts', resolveDir: directory,
			contents: path.endsWith('preferences.ts') ? 'export const preferences = { s: { visualModuleAutoConnectOnNodeAdd: true, forceTypeSafety: true } };'
				: ['fill', 'invert', 'image', 'testStructArray'].map((id, index) =>
					"import effect" + index + " from '@gs/subsystems_effect_shared/fx/" + id + "/_def_.ts';").join('\n')
					+ 'export const effectDefinitions = Object.fromEntries([effect0, effect1, effect2, effect3].map(effect => [effect.id, effect]));',
		}));
	} }],
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
const { ProjectContext, ProjectScriptingController, createProjectVisualModule } = loaded.exports;

function fixture(overrides = {}, handler = async () => null) {
	const project = new ProjectContext(createTestProject(overrides));
	const dialogs = [];
	const scripting = new ProjectScriptingController(project, async (request, signal) => {
		dialogs.push(request);
		return handler(request, signal);
	});
	const manager = project.stateManager;
	return { project, manager, scripting, dialogs,
		run: async source => { scripting.source.value = source; await scripting.run(); },
		output: () => scripting.output.value.map(entry => entry.text),
	};
}

// 【実際のAiScriptでノードグラフを完成させ、一回のUndoとRedoで同じ状態を復元する】
// 生成ID・乱数・明示的な接続を履歴へ保存し、環境設定の自動接続やスクリプト再実行に依存しない。
test('builds a graph and replays the exact operations as one history entry', async () => {
	const f = fixture();
	await f.run([
		'let visualModule = VisualModule:create("Generated")',
		'let fillNode = VisualModule:Node:createEffect(visualModule, "fill")',
		'let invertNode = VisualModule:Node:createEffect(visualModule, "invert")',
		'VisualModule:Node:setLiteral(fillNode, ["color"], [Math:rnd(), 0.2, -0.1, 1])',
		'VisualModule:Node:setDisplayName(fillNode, "Background")',
		'VisualModule:Node:setBypass(invertNode, true)',
		'<: VisualModule:get(visualModule).nodes[3].inputs',
		'VisualModule:Node:connect(fillNode, "output", invertNode, ["input"])',
		'VisualModule:connectOutput(visualModule, VisualModule:get(visualModule).primaryOutputId, invertNode, "output")',
	].join('\n'));
	assert.equal(f.scripting.status.value, 'succeeded', f.output().join('\n'));
	assert.deepEqual(f.output(), ['{}']);
	assert.equal(f.manager.undoStack.value.length, 1);
	assert.equal(f.manager.undoStack.value[0].label, 'Run script');
	const after = f.project.snapshot();
	assert.equal(after.visualModules[0].nodes[1].displayName, 'Background');
	f.manager.undo();
	assert.deepEqual(f.project.snapshot().visualModules, []);
	f.manager.redo();
	assert.deepEqual(f.project.snapshot(), after);
	assert.equal(f.scripting.output.value.length, 1);
});

// 【実行時エラーまでの編集を残し、不正な一操作は適用せずUndo可能にする】
// スクリプト全体のロールバックと、引数不正による一操作の失敗を区別する。
test('keeps successful edits on error without applying an invalid parameter value', async () => {
	const f = fixture();
	await f.run([
		'let visualModule = VisualModule:create("Partial")',
		'let fillNode = VisualModule:Node:createEffect(visualModule, "fill")',
		'VisualModule:Node:setLiteral(fillNode, ["color"], [1, 0, 0, 1])',
		'VisualModule:Node:setLiteral(fillNode, ["color"], "invalid")',
		'VisualModule:create("Unreachable")',
	].join('\n'));
	assert.equal(f.scripting.status.value, 'failed');
	assert.equal(f.dialogs.at(-1).kind, 'error');
	assert.match(f.dialogs.at(-1).text, /VisualModule:Node:setLiteral/);
	assert.equal(f.manager.state.visualModules.value.length, 1);
	assert.deepEqual(f.project.snapshot().visualModules[0].nodes[1].params.color.value, [1, 0, 0, 1]);
	assert.equal(f.manager.undoStack.value.length, 1);
	f.manager.undo();
	assert.equal(f.manager.state.visualModules.value.length, 0);
	f.manager.redo();
	assert.equal(f.manager.state.visualModules.value.length, 1);
});

// 【取得値の編集では保存状態を変えず、読み取りだけの実行でRedoを失わない】
// プロジェクト・定義の実体をスクリプトへ漏らさず、出力は出力時点の値として保持する。
test('returns detached snapshots and preserves redo for read-only runs', async () => {
	const f = fixture();
	await f.run('VisualModule:create("Undo me")');
	f.manager.undo();
	await f.run([
		'let project = Project:get()',
		'project.name = "Local only"',
		'let effect = Effect:get("fill")',
		'effect.paramDefs.color.defaultValue.value[0] = 42',
		'<: Effect:get("fill").paramDefs.color.defaultValue.value[0]',
		'let output = [1]',
		'<: output',
		'output[0] = 2',
	].join('\n'));
	assert.equal(f.scripting.status.value, 'succeeded');
	assert.equal(f.manager.state.name.value, 'Project');
	assert.deepEqual(f.output(), ['1', '[1]']);
	assert.equal(f.manager.undoStack.value.length, 0);
	assert.equal(f.manager.redoStack.value.length, 1);
	await f.run('<: project');
	assert.equal(f.scripting.status.value, 'failed');
	assert.equal(f.manager.redoStack.value.length, 1);
});

// 【ダイアログ待ちを挟んでも操作を一つの履歴へまとめる】
// AiScript側は応答を通常の戻り値として使える。Redoでダイアログを再表示しない。
test('waits for dialog answers and groups operations across the wait', async () => {
	let answer;
	let opened;
	const ready = new Promise(resolve => { opened = resolve; });
	const f = fixture({}, request => request.kind === 'inputText' ? new Promise(resolve => { answer = resolve; opened(); }) : Promise.resolve(null));
	const running = f.run('VisualModule:create("Before")\nlet name = Dialog:inputText("Name", "Default")\nVisualModule:create(name)');
	await ready;
	assert.equal(f.scripting.isRunning.value, true);
	assert.equal(f.manager.state.visualModules.value.length, 1);
	assert.equal(f.manager.undoStack.value.length, 0);
	answer('After');
	await running;
	assert.equal(f.scripting.status.value, 'succeeded');
	assert.equal(f.manager.undoStack.value.length, 1);
	const after = f.project.snapshot();
	f.manager.undo();
	assert.equal(f.manager.state.visualModules.value.length, 0);
	f.manager.redo();
	assert.deepEqual(f.project.snapshot(), after);
	assert.equal(f.dialogs.length, 1);
});

// 【キャンセル・空入力・確認拒否を異なる戻り値として扱う】
// キャンセルを自動終了や空文字列へ変換すると、スクリプト側の分岐が成立しなくなる。
test('keeps dialog cancellation distinct from empty input and allows explicit exit', async () => {
	const replies = [null, '', false, 'second'];
	const f = fixture({}, async () => replies.shift());
	await f.run([
		'<: Dialog:inputText("Cancel")',
		'<: readline("Empty")',
		'<: Dialog:confirm("No")',
		'<: Dialog:select("Choose", [{id: "first", label: "First"}, {id: "second", label: "Second"}])',
		'VisualModule:create("Kept")',
		'Script:exit()',
		'VisualModule:create("Unreachable")',
	].join('\n'));
	assert.equal(f.scripting.status.value, 'exited', f.output().join('\n'));
	assert.deepEqual(f.output(), ['null', '', 'false', 'second']);
	assert.equal(f.manager.state.visualModules.value.length, 1);
	assert.equal(f.dialogs.length, 4);
	f.manager.undo();
	assert.equal(f.manager.state.visualModules.value.length, 0);
});

// 【バックグラウンド関数は別名で呼んでも開始前に拒否する】
// トップレベル終了後の編集が確定済みの履歴や破棄済みセッションに書き込むことを防ぐ。
test('rejects background execution even through aliases', async () => {
	for (const name of ['Async:timeout', 'Async:interval']) {
		const f = fixture();
		await f.run('let schedule = ' + name + '\nschedule(0, @() { VisualModule:create("Late") })');
		assert.equal(f.scripting.status.value, 'failed');
		assert.match(f.output().at(-1), /unavailable/);
		assert.equal(f.manager.state.visualModules.value.length, 0);
		assert.equal(f.manager.undoStack.value.length, 0);
	}
});

// 【セッション終了時に待機を解消し、遅れて届く入力で編集を再開しない】
// パネルの寿命から実行を切り離しても、セッション破棄後の応答は失効する必要がある。
test('disposes a waiting run without losing prior undo or accepting late edits', async () => {
	let opened;
	const ready = new Promise(resolve => { opened = resolve; });
	const f = fixture({}, (_request, signal) => new Promise(resolve => {
		signal.addEventListener('abort', () => resolve('Late'), { once: true });
		opened();
	}));
	const running = f.run('VisualModule:create("Before")\nDialog:inputText("Wait")\nVisualModule:create("After")');
	await ready;
	f.scripting.dispose();
	await running;
	assert.equal(f.manager.state.visualModules.value.length, 1);
	assert.equal(f.manager.undoStack.value.length, 1);
	assert.equal(f.dialogs.length, 1);
	f.manager.undo();
	assert.equal(f.manager.state.visualModules.value.length, 0);
});

// 【式・加工式・ネストした末端・素材の静的参照を同じAPI境界で編集する】
// 固定値への切替で加工式を失わず、配列のindexを要素IDとして誤って扱わない。
test('edits bindings, nested paths and existing asset settings', async () => {
	const f = fixture({ assets: [{ id: 'image', name: 'Image', width: 10, height: 10, fileDataType: 'image/png', fileData: new Blob([]) }] });
	await f.run([
		'let visualModule = VisualModule:create("Bindings")',
		'let fillNode = VisualModule:Node:createEffect(visualModule, "fill")',
		'VisualModule:Node:setExpression(fillNode, ["color"], "[1, 0, 0, 1]")',
		'VisualModule:Node:setExpressionModifier(fillNode, ["color"], {enabled: true, code: "VALUE"})',
		'VisualModule:Node:setLiteral(fillNode, ["color"], [0, 1, 0, 1])',
		'<: VisualModule:Node:getParameter(fillNode, ["color"]).binding.expressionModifier.enabled',
		'VisualModule:Node:resetParameter(fillNode, ["color"])',
		'let nestedNode = VisualModule:Node:createEffect(visualModule, "testStructArray")',
		'VisualModule:Node:setLiteral(nestedNode, ["buzzs", "first", "x"], 0.25)',
		'let imageNode = VisualModule:Node:createEffect(visualModule, "image", {image: Asset:list()[0].id})',
		'<: VisualModule:Node:getStaticSetting(imageNode, "image")',
		'VisualModule:Node:setStaticSetting(imageNode, "image", null)',
	].join('\n'));
	assert.equal(f.scripting.status.value, 'succeeded', f.output().join('\n'));
	assert.deepEqual(f.output(), ['true', 'image']);
	const nodes = f.project.snapshot().visualModules[0].nodes;
	assert.deepEqual(nodes[1].params.color, { inputSource: 'literal', value: [1, 1, 1, 1] });
	assert.equal(nodes[2].params.buzzs.value[0].binding.value.x.value, 0.25);
	assert.equal(nodes[3].staticSettings.image, null);
});

// 【不正な参照・引数・関数・循環データは変更前に拒否する】
// 型を持たないスクリプトの入力を、そのままCommandの信頼済みpayloadへ流さない。
test('validates references, arguments, functions and cyclic data', async () => {
	for (const invalid of [
		'VisualModule:Node:createEffect(visualModule, "missing")',
		'VisualModule:Node:createEffect(visualModule, "image", {image: "missing"})',
		'VisualModule:Node:setLiteral(fillNode, ["missing"], 1)',
		'VisualModule:Node:setLiteral(fillNode, ["color"], @() {})',
		'let cyclic = []\ncyclic.push(cyclic)\nVisualModule:Node:setLiteral(fillNode, ["color"], cyclic)',
		'VisualModule:rename(visualModule, "New", "extra")',
		'VisualModule:Node:connect(fillNode, "missing", fillNode, ["color"])',
	]) {
		const f = fixture();
		await f.run('let visualModule = VisualModule:create("Valid")\nlet fillNode = VisualModule:Node:createEffect(visualModule, "fill")\n' + invalid);
		assert.equal(f.scripting.status.value, 'failed', invalid);
		const definition = f.project.snapshot().visualModules[0];
		assert.equal(definition.name, 'Valid');
		assert.equal(definition.nodes.length, 3);
		assert.deepEqual(definition.nodes[1].params.color.value, [1, 1, 1, 1]);
	}
});

// 【削除時の既存配線の補正と、利用中Visual Moduleの保護を履歴に含める】
// 個々のノードを消した後も参照を壊さず、定義削除がレイヤーを暗黙に削除しないことを保証する。
test('restores rewired nodes and rejects deleting referenced Visual Modules', async () => {
	const f = fixture();
	await f.run([
		'let visualModule = VisualModule:create("Graph")',
		'let fillNode = VisualModule:Node:createEffect(visualModule, "fill")',
		'let invertNode = VisualModule:Node:createEffect(visualModule, "invert")',
		'VisualModule:Node:connect(fillNode, "output", invertNode, ["input"])',
		'VisualModule:connectOutput(visualModule, VisualModule:get(visualModule).primaryOutputId, invertNode, "output")',
	].join('\n'));
	const before = f.project.snapshot();
	await f.run('let visualModule = VisualModule:list()[0].reference\nVisualModule:Node:remove(VisualModule:Node:list(visualModule)[2].reference)');
	const after = f.project.snapshot().visualModules[0];
	assert.equal(after.nodes.at(-1).inputs[after.primaryOutputId].nodeId, after.nodes[1].id);
	f.manager.undo();
	assert.deepEqual(f.project.snapshot(), before);
	const definition = createProjectVisualModule(0);
	const used = fixture({ visualModules: [definition], timelineScenes: [{ id: 'scene', layers: [{ id: 'layer', layerType: 'visualModule', visualModuleId: definition.id }] }] });
	await used.run('VisualModule:remove(VisualModule:list()[0].reference)');
	assert.equal(used.scripting.status.value, 'failed');
	assert.equal(used.manager.undoStack.value.length, 0);
	assert.equal(used.manager.state.visualModules.value.length, 1);
	await f.run('VisualModule:remove(VisualModule:list()[0].reference)');
	assert.equal(f.manager.state.visualModules.value.length, 0);
	f.manager.undo();
	assert.deepEqual(f.project.snapshot(), before);
});

// 【インラインVisual Moduleも同じ参照形式で編集し、定義の登録操作とは区別する】
// Sceneとレイヤーの所在を失わず、他のVisual Moduleとの誤接続を拒否する。
test('supports inline targets and rejects cross-Visual-Module connections', async () => {
	const definition = createProjectVisualModule(0);
	const f = fixture({ timelineScenes: [{ id: 'scene', layers: [{ id: 'inline', layerType: 'inlineVisualModule', visualModule: definition }] }] });
	await f.run([
		'let inlineVisualModule = VisualModule:list()[0].reference',
		'let destination = VisualModule:Node:createEffect(inlineVisualModule, "invert")',
		'let registered = VisualModule:create("Registered")',
		'let source = VisualModule:Node:createEffect(registered, "fill")',
		'VisualModule:Node:connect(source, "output", destination, ["input"])',
	].join('\n'));
	assert.equal(f.scripting.status.value, 'failed');
	assert.match(f.output().at(-1), /same Visual Module/);
	assert.equal(f.manager.state.timelineScenes.value[0].layers[0].visualModule.nodes.length, 3);
	f.manager.undo();
	assert.equal(f.manager.state.timelineScenes.value[0].layers[0].visualModule.nodes.length, 2);
});

// 【循環する出力を表示でき、出力上限後も実行とエラー報告を継続する】
// 出力欄の容量制限を編集処理の失敗と混同せず、エラーの原因を見失わない。
test('bounds output and still records errors after truncation', async () => {
	const f = fixture();
	await f.run('let cyclic = []\ncyclic.push(cyclic)\n<: cyclic\nfor 1100 { <: "line" }\nVisualModule:create("After output")\nCore:abort("Failure")');
	assert.equal(f.scripting.status.value, 'failed');
	assert.equal(f.scripting.output.value[0].text, '[<circular>]');
	assert.equal(f.scripting.output.value.filter(entry => entry.kind === 'truncated').length, 1);
	assert.equal(f.scripting.output.value.at(-1).kind, 'error');
	assert.equal(f.manager.state.visualModules.value.length, 1);
	assert.equal(f.manager.undoStack.value.length, 1);
});
