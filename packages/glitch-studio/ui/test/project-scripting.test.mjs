import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const directory = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({
	absWorkingDir: directory, bundle: true, platform: 'node', format: 'cjs', write: false,
	stdin: { resolveDir: directory, loader: 'ts', contents: `
		export { ProjectScriptingController } from './src/scripting/ProjectScriptingController.ts';
		export { ProjectScriptRuntime } from './src/scripting/project-script-runtime.ts';
		export { COMMAND_DEFS } from './src/commands.ts';
		export { UndoRedo } from './src/utility/undo-redo.ts';
		export { Interpreter, Parser } from '@syuilo/aiscript';
	` },
	plugins: [{ name: 'scripting-effects', setup(build) {
		build.onResolve({ filter: /(?:effect-definitions|native-effects[\\/]definitions)\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'test' }));
		build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ loader: 'ts', resolveDir: directory, contents: `
			import fill from '@gs/subsystems_effect-new_native-effects/fx/fill/_def_.ts';
			export const nativeEffectDefinitions = { fill };
		` }));
	} }],
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
const { ProjectScriptingController, ProjectScriptRuntime, COMMAND_DEFS, UndoRedo, Interpreter, Parser } = loaded.exports;

function fixture(dialog = async () => null) {
	const state = {
		name: { value: 'Project' }, description: { value: '' }, author: { value: '' },
		resolution: { value: { width: 1920, height: 1080 } }, timelineFps: { value: 30 },
		timelineMotionBlur: { value: { enabled: false, shutterAngle: 180, samples: 8 } }, exportSettings: { value: null },
		automationGraphs: { value: [] }, customShaderEffects: { value: [] }, generatedSpeech: { value: [] },
		assets: { value: [] }, players: { value: [] }, customNodeGraphEffects: { value: [] }, timelineScenes: { value: [] },
	};
	const manager = new UndoRedo(state, COMMAND_DEFS);
	const errors = [];
	const controller = new ProjectScriptingController(manager, { dialog, showError: async message => { errors.push(message); }, historyLabel: 'Run script', outputTruncated: 'Output truncated' });
	return { controller, manager, state, errors };
}

function deferred() {
	let resolve;
	const promise = new Promise(done => { resolve = done; });
	return { promise, resolve };
}

// 【初期サンプルから作成した配線・色と対象IDを一履歴として復元する】
// 実際のAiScript変換、公開Command、読み取りAPIを通し、Redoでスクリプトを再実行しないことを確認する。
test('runs the default named Command example and redoes its exact result', async () => {
	const { controller, manager, state, errors } = fixture();
	await controller.run();
	assert.deepEqual(errors, []);
	const customNodeGraphEffect = structuredClone(state.customNodeGraphEffects.value[0]);
	const node = customNodeGraphEffect.definition.nodes.find(node => node.type === 'effect');
	assert.deepEqual(node.params.color.value, [1, 0.2, 0.1, 1]);
	assert.equal(customNodeGraphEffect.definition.outputSources[customNodeGraphEffect.definition.primaryOutput].nodeId, node.id);
	assert.equal(manager.undoStack.value.length, 1);
	assert.match(controller.output.value[0], /Generated/);
	manager.undo();
	assert.deepEqual(state.customNodeGraphEffects.value, []);
	manager.redo();
	assert.deepEqual(state.customNodeGraphEffects.value, [customNodeGraphEffect]);
	assert.equal(controller.output.value.length, 1);
});

// 【AiScriptで中継ノードを追加し、入力を接続・解除できる】
// コマンド定義だけを変更して公開リストへの登録を忘れると呼び出せないため、
// 実際のスクリプトから両方の操作を実行し、読み取り結果と履歴も確認する。
test('creates and rewires a relay node from AiScript', async () => {
	const { controller, manager, state, errors } = fixture();
	controller.source.value = `let customNodeGraphEffect = Command:createCustomNodeGraphEffect({})
let source = Command:createCustomNodeGraphEffectEffectNode({ customNodeGraphEffect: customNodeGraphEffect, effectSource: { type: "nativeEffect", id: "fill" } })
let relay = Command:createCustomNodeGraphEffectRelayNode({ customNodeGraphEffect: customNodeGraphEffect })
let connection = { nodeId: source.nodeId, outputPort: "output" }
Command:setCustomNodeGraphEffectRelayInput({ target: relay, source: connection })
<: Query:getNode(relay).input.outputPort
Command:setCustomNodeGraphEffectRelayInput({ target: relay, source: null })
<: Query:getNode(relay).input.nodeId == null
Command:setCustomNodeGraphEffectRelayInput({ target: relay, source: connection })`;
	await controller.run();
	assert.deepEqual(errors, []);
	assert.deepEqual(controller.output.value, ['output', 'true']);
	const customNodeGraphEffect = structuredClone(state.customNodeGraphEffects.value[0]);
	const source = customNodeGraphEffect.definition.nodes.find(node => node.type === 'effect');
	const relay = customNodeGraphEffect.definition.nodes.find(node => node.type === 'relay');
	assert.deepEqual(relay.input, { nodeId: source.id, outputPort: 'output' });
	assert.equal(manager.undoStack.value.length, 1);
	manager.undo();
	assert.deepEqual(state.customNodeGraphEffects.value, []);
	manager.redo();
	assert.deepEqual(state.customNodeGraphEffects.value, [customNodeGraphEffect]);
});

// 【実行途中の検証エラーでも出力と成功済み編集を残す】
// エラー表示時には履歴を確定し、失敗後の文は実行せず、一回のUndoで開始前へ戻せる必要がある。
test('retains completed changes and output after an API failure', async () => {
	const { controller, manager, state, errors } = fixture();
	controller.source.value = `Command:setProjectName({ name: "Before failure" })
<: "progress"
Command:setProjectResolution({ resolution: { width: 0, height: 100 } })
Command:setProjectName({ name: "Must not run" })`;
	await controller.run();
	assert.equal(state.name.value, 'Before failure');
	assert.equal(manager.undoStack.value.length, 1);
	assert.equal(errors.length, 1);
	assert.match(errors[0], /positive integers/);
	assert.equal(controller.output.value[0], 'progress');
	assert.equal(controller.isRunning.value, false);
	manager.undo();
	assert.equal(state.name.value, 'Project');
});

// 【ダイアログの応答まで次の文を待ち、応答後も同じ履歴へまとめる】
// キャンセル、空文字列、選択IDの違いをそのまま渡し、Redoでダイアログを再表示しない。
test('awaits dialog responses and keeps cancellation distinct from empty input', async () => {
	const entered = deferred();
	const answer = deferred();
	const requests = [];
	const { controller, manager, state, errors } = fixture(async request => {
		requests.push(request);
		if (request.kind === 'confirm') { entered.resolve(); return answer.promise; }
		if (request.kind === 'input_text') return request.text === 'Cancel' ? null : '';
		if (request.kind === 'select') return 'second';
		return null;
	});
	controller.source.value = `Command:setProjectName({ name: "Before dialog" })
<: Dialog:confirm({ text: "Continue?" })
Command:setProjectName({ name: "After dialog" })
<: Core:type(Dialog:input_text({ text: "Cancel" }))
<: Core:type(Dialog:input_text({ text: "Empty", default: "" }))
<: Dialog:select({ items: [{ id: "first", label: "First" }, { id: "second", label: "Second" }] })`;
	const pending = controller.run();
	await entered.promise;
	assert.equal(state.name.value, 'Before dialog');
	assert.equal(controller.isRunning.value, true);
	assert.equal(manager.undoStack.value.length, 0);
	answer.resolve(false);
	await pending;
	assert.deepEqual(errors, []);
	assert.deepEqual(controller.output.value, ['false', 'null', 'str', 'second']);
	assert.equal(manager.undoStack.value.length, 1);
	manager.undo(); manager.redo();
	assert.equal(state.name.value, 'After dialog');
	assert.equal(requests.length, 4);
	assert.equal(requests.at(-1).defaultValue, 'first');
});

// 【取得結果と実行ごとの変数をプロジェクトから切り離す】
// 同値の設定・読み取り・構文エラーによって既存Redoを失わず、前の実行の変数にも依存させない。
test('isolates queried data and fresh execution variables without destroying redo', async () => {
	const { controller, manager, state, errors } = fixture();
	manager.commit('setProjectName', { name: 'Edited' });
	manager.undo();
	controller.source.value = `let saved = Query:getProject()
saved.name = "Local only"
Command:setProjectName({ name: "Project" })
<: Query:getProject().name`;
	await controller.run();
	assert.equal(state.name.value, 'Project');
	assert.deepEqual(controller.output.value, ['Project']);
	assert.equal(manager.redoStack.value.length, 1);
	controller.source.value = '<: saved';
	await controller.run();
	assert.match(errors.at(-1), /saved/);
	controller.source.value = 'Command:setProjectName({ name: "Never parsed" })\nlet =';
	await controller.run();
	assert.equal(state.name.value, 'Project');
	assert.equal(manager.redoStack.value.length, 1);
});

// 【正常な早期終了は成功済み編集を残し、エラーとして表示しない】
// 入力をキャンセルしたスクリプトが、例外ダイアログを出さずに処理を終えられるようにする。
test('finishes normally with Script exit and preserves completed edits', async () => {
	const { controller, manager, state, errors } = fixture();
	controller.source.value = 'Command:setProjectName({ name: "Kept" })\nScript:exit()\nCommand:setProjectName({ name: "Skipped" })';
	await controller.run();
	assert.deepEqual(errors, []);
	assert.equal(state.name.value, 'Kept');
	assert.equal(manager.undoStack.value.length, 1);
});

// 【タイマーを別名に保持してもバックグラウンド実行を開始できない】
// ASTの名前検査だけでは別名呼び出しを防げず、完了後に履歴の外で編集されるため、関数境界で拒否する。
test('rejects background timers without changing other AiScript environments', async () => {
	const { controller, errors } = fixture();
	controller.source.value = 'let delayed = Async:timeout\ndelayed(0, @() { <: "Too late" })';
	await controller.run();
	assert.match(errors[0], /unavailable/);
	assert.equal(controller.output.value.some(value => value.includes('Too late')), false);
	const output = [];
	const interpreter = new Interpreter({}, { out: value => output.push(value.value) });
	await interpreter.exec(new Parser().parse('Core:sleep(0)\n<: "unaffected"'));
	assert.deepEqual(output, ['unaffected']);
});

// 【APIへ関数や循環データを渡しても文字列化や部分編集をしない】
// 値の変換失敗をCommand適用前に報告し、通常データの境界を維持する。
test('rejects function and cyclic API arguments before applying changes', async () => {
	const { controller, state, errors } = fixture();
	controller.source.value = 'Command:setProjectName({ name: @() { "invalid" } })';
	await controller.run();
	assert.match(errors.at(-1), /accept only/);
	controller.source.value = 'let cyclic = {}\ncyclic.self = cyclic\nCommand:setProjectName(cyclic)';
	await controller.run();
	assert.match(errors.at(-1), /Cyclic/);
	assert.equal(state.name.value, 'Project');
});

// 【出力の循環参照・大量出力でパネルが無制限に増えない】
// オブジェクトは出力時点の内容を記録し、後の変更では書き換わらないことも確認する。
test('bounds output and formats snapshots and cyclic values', async () => {
	const { controller, errors } = fixture();
	controller.source.value = 'let data = { value: 1 }\n<: data\ndata.value = 2\ndata.self = data\n<: data\nfor 1100 { <: "line" }';
	await controller.run();
	assert.deepEqual(errors, []);
	assert.match(controller.output.value[0], /1/);
	assert.match(controller.output.value[1], /Circular/);
	assert.equal(controller.output.value.length, 1001);
	assert.equal(controller.output.value.at(-1), 'Output truncated');
});

// 【セッション終了時に入力待ちを終え、応答後の文を実行しない】
// 停止ボタンを提供しなくても、閉じたプロジェクトへ遅れて入力結果を反映してはならない。
test('disposes dialog waits without applying later script statements', async () => {
	const entered = deferred();
	const { controller, state, errors } = fixture((_request, signal) => new Promise(resolve => {
		signal.addEventListener('abort', () => resolve(null), { once: true });
		entered.resolve();
	}));
	controller.source.value = 'Dialog:input_text({})\nCommand:setProjectName({ name: "Closed" })';
	const pending = controller.run();
	await entered.promise;
	controller.dispose();
	await pending;
	assert.deepEqual(errors, []);
	assert.equal(state.name.value, 'Project');
});

// 【並行評価される配列callbackのCommandも順番に準備・適用する】
// 非同期prepareが同じ編集前状態を記録するとUndoで戻る値が壊れるため、ホスト呼び出しの順序を確認する。
test('serializes host commands invoked by concurrent array callbacks', async () => {
	const firstEntered = deferred();
	const firstAnswer = deferred();
	const calls = [];
	const runtime = new ProjectScriptRuntime({
		commands: [{ name: 'edit', label: 'Edit' }], queries: {}, output() {}, dialog: async () => null,
		executeCommand: async (_name, input) => {
			calls.push(input.value);
			if (calls.length === 1) { firstEntered.resolve(); await firstAnswer.promise; }
		},
	});
	const pending = runtime.run('[1, 2, 3].map(@(value) { Command:edit({ value: value }) })');
	await firstEntered.promise;
	assert.deepEqual(calls, [1]);
	firstAnswer.resolve();
	await pending;
	assert.deepEqual(calls, [1, 2, 3]);
});

// 【無限ループを実行ステップの上限で終了させる】
// 入力待ちの経過時間には制限を設けず、計算を継続するスクリプトだけを打ち切る。
test('limits execution steps independently of dialog wait duration', async () => {
	const runtime = new ProjectScriptRuntime({ commands: [], queries: {}, output() {}, dialog: async () => null, executeCommand: async () => null }, 100);
	await assert.rejects(runtime.run('loop {}'), /max step exceeded/);
});

// 【外部実行はパネル本文と出力を保ち、成功済み編集だけを一履歴に残す】
// MCPからの失敗をUIダイアログで表示したり、利用者の編集中スクリプトへ上書きしてはならない。
test('keeps external script results separate and retains partial edits in one undo group', async () => {
	const { controller, manager, state, errors } = fixture();
	controller.source.value = '<: "Panel source"';
	controller.output.value = ['Panel output'];
	const result = await controller.runExternal(`Command:setProjectName({ name: "External" })
Command:setProjectAuthor({ author: "Author" })
<: Query:getProject().name
Dialog:confirm({ text: "Unavailable" })
Command:setProjectName({ name: "Must not run" })`, new AbortController().signal, 'MCP: Run script');
	assert.deepEqual(result.output, ['External']);
	assert.equal(result.commandsExecuted, 2);
	assert.match(result.error, /Dialogs are unavailable/);
	assert.deepEqual(errors, []);
	assert.equal(controller.source.value, '<: "Panel source"');
	assert.deepEqual(controller.output.value, ['Panel output']);
	assert.equal(controller.isRunning.value, false);
	assert.equal(state.name.value, 'External');
	assert.equal(manager.undoStack.value.length, 1);
	assert.equal(manager.undoStack.value[0].label, 'MCP: Run script');
	manager.undo();
	assert.equal(state.name.value, 'Project');
	assert.equal(state.author.value, '');
	manager.redo();
	assert.equal(state.name.value, 'External');
});

// 【パネル実行中に外部実行を開始せず、同じセッションの履歴グループを重ねない】
// パネルとMCPに別々の実行フラグを置くと、それぞれが他方の編集を包含してUndoが壊れる。
test('rejects external execution while a panel script is waiting', async () => {
	const entered = deferred();
	const answer = deferred();
	const { controller } = fixture(async () => { entered.resolve(); return answer.promise; });
	controller.source.value = 'Dialog:confirm({})';
	const panel = controller.run();
	await entered.promise;
	await assert.rejects(controller.runExternal('<: "Rejected"', new AbortController().signal), /PROJECT_BUSY/);
	answer.resolve(true);
	await panel;
});

// 【外部実行の中断は準備中Commandの適用を防ぎ、手動操作を含む成功済み履歴を確定する】
// 中断の応答後に編集が遅れて適用されたり、パネル実行が同時に始まることを防ぐ。
test('cancels pending external commands while preserving completed and manual changes', async () => {
	const { controller, manager, state, errors } = fixture();
	const entered = deferred();
	const resume = deferred();
	const execute = manager.execute.bind(manager);
	manager.execute = async (...args) => {
		if (args[1].name === 'Pending') { entered.resolve(); await resume.promise; }
		return execute(...args);
	};
	controller.source.value = 'Command:setProjectName({ name: "Panel must not run" })';
	const cancellation = new AbortController();
	const execution = controller.runExternal('Command:setProjectName({ name: "Kept" })\nCommand:setProjectName({ name: "Pending" })', cancellation.signal);
	await entered.promise;
	await controller.run();
	manager.commit('setProjectAuthor', { author: 'Manual edit' });
	cancellation.abort(new Error('Cancelled by client'));
	resume.resolve();
	const result = await execution;
	assert.match(result.error, /Cancelled by client/);
	assert.equal(result.commandsExecuted, 1);
	assert.equal(state.name.value, 'Kept');
	assert.equal(state.author.value, 'Manual edit');
	assert.equal(manager.undoStack.value.length, 1);
	manager.undo();
	assert.equal(state.name.value, 'Project');
	assert.equal(state.author.value, '');
	assert.deepEqual(errors, []);
	assert.equal(controller.isRunning.value, false);
});

// 【外部出力は明示した上限を超えず、セッション終了後の要求を受け付けない】
// クライアントへ無制限に結果を返すことと、終了したProjectの再編集を防ぐ。
test('bounds external output and refuses disposed sessions', async () => {
	const { controller } = fixture();
	const result = await controller.runExternal('for 1100 { <: "line" }', new AbortController().signal);
	assert.equal(result.error, null);
	assert.equal(result.output.length, 1000);
	assert.equal(result.outputTruncated, true);
	controller.dispose();
	await assert.rejects(controller.runExternal('<: "Closed"', new AbortController().signal), /PROJECT_CLOSED/);
});
