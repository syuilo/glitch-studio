import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const directory = fileURLToPath(new URL('../', import.meta.url));
const bundled = await build({
	absWorkingDir: directory, bundle: true, platform: 'node', format: 'cjs', write: false,
	stdin: { resolveDir: directory, loader: 'ts', contents: `
		export { getProjectScriptApiReference, searchProjectScriptApi } from './src/scripting/project-script-api-reference.ts';
		export { SCRIPT_COMMAND_NAMES } from './src/scripting/script-command-names.ts';
		export { PROJECT_SCRIPT_QUERY_DEFINITIONS } from './src/scripting/project-script-queries.ts';
		export { ProjectScriptingController } from './src/scripting/ProjectScriptingController.ts';
		export { COMMAND_DEFS } from './src/commands.ts';
		export { UndoRedo } from './src/utility/undo-redo.ts';
		export { Parser } from '@syuilo/aiscript';
	` },
	plugins: [{ name: 'project-api-effects', setup(build) {
		build.onResolve({ filter: /(?:effect-definitions|native-effects[\\/]definitions)\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'test' }));
		build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ loader: 'ts', resolveDir: directory, contents: `
			import fill from '@gs/subsystems_effect-new_native-effects/fx/fill/_def_.ts';
			export const nativeEffectDefinitions = { fill };
		` }));
	} }],
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
const { getProjectScriptApiReference, searchProjectScriptApi, SCRIPT_COMMAND_NAMES, PROJECT_SCRIPT_QUERY_DEFINITIONS,
	ProjectScriptingController, COMMAND_DEFS, UndoRedo, Parser } = loaded.exports;

function fixture() {
	const state = {
		name: { value: 'Project' }, description: { value: '' }, author: { value: '' },
		resolution: { value: { width: 1920, height: 1080 } }, timelineFps: { value: 30 },
		timelineMotionBlur: { value: { enabled: false, shutterAngle: 180, samples: 8 } }, exportSettings: { value: null },
		automationGraphs: { value: [] }, customShaderEffects: { value: [] }, generatedSpeech: { value: [] },
		assets: { value: [] }, players: { value: [] }, customNodeGraphEffects: { value: [] }, timelineScenes: { value: [] },
	};
	const manager = new UndoRedo(state, COMMAND_DEFS);
	const errors = [];
	const controller = new ProjectScriptingController(manager, {
		dialog: async () => null, showError: async message => { errors.push(message); }, historyLabel: 'Run script', outputTruncated: 'Output truncated',
	});
	return { controller, manager, state, errors };
}

// 【公開された全APIの契約と使用例を実行中の定義から取得できる】
// CommandやQueryを増やしたときの資料の付け忘れ、JSONへ変換できないスキーマ、
// AiScriptとして構文が成立しないサンプルをまとめて検出する。
test('documents every public Command and Query with serializable schemas and parsable examples', () => {
	const expected = [...SCRIPT_COMMAND_NAMES.map(name => `Command:${name}`), ...Object.keys(PROJECT_SCRIPT_QUERY_DEFINITIONS)];
	assert.deepEqual(searchProjectScriptApi('').map(entry => entry.name), expected);
	for (const name of expected) {
		const reference = getProjectScriptApiReference(name);
		assert.ok(reference.description.length > 0, name);
		assert.ok(reference.examples.length > 0, name);
		assert.deepEqual(JSON.parse(JSON.stringify(reference)), reference, name);
		for (const source of reference.examples) assert.doesNotThrow(() => new Parser().parse(source), name);
	}
	assert.throws(() => getProjectScriptApiReference('Command:insertImportedAssets'), /Unknown project API/);
	assert.throws(() => getProjectScriptApiReference('Query:__proto__'), /Unknown project API/);
});

// 【検索と詳細取得だけでは状態やUndo履歴を変更しない】
// AIや利用者が操作前にAPIを調べられること、取得資料の書き換えが他の呼び出しへ
// 影響しないこと、一覧へ巨大なスキーマを埋め込まないことを確認する。
test('exposes searchable detached references to AiScript without editing the project', async () => {
	const { controller, manager, errors } = fixture();
	controller.source.value = '<: Script:search("createCustomNodeGraphEffect")\nlet reference = Script:describe("Command:createCustomNodeGraphEffect")\nreference.description = "Local"\n<: Script:describe("Command:createCustomNodeGraphEffect").description';
	await controller.run();
	assert.deepEqual(errors, []);
	assert.equal(manager.undoStack.value.length, 0);
	assert.match(controller.output.value[0], /Command:createCustomNodeGraphEffect/);
	assert.notEqual(controller.output.value[1], 'Local');
	assert.equal(Object.hasOwn(searchProjectScriptApi('createCustomNodeGraphEffect')[0], 'inputSchema'), false);
});

// 【自己完結した公開サンプルが新規プロジェクト上でCommand・Queryを呼び出せる】
// 型として説明が正しくても、省略時の値や対象参照を取り違えた例では作品を作れない。
// 既存素材などの前提を先頭コメントに示した断片は上の構文検証で扱い、ここでは
// 自己完結する例だけを実行する。外部ファイルの取り込みをテストに持ち込まない。
test('runs self-contained public Command examples against a fresh project', async t => {
	for (const name of SCRIPT_COMMAND_NAMES) {
		const examples = getProjectScriptApiReference(`Command:${name}`).examples.filter(source => !source.trimStart().startsWith('//'));
		if (examples.length === 0) continue;
		await t.test(name, async () => {
			for (const source of examples) {
				const { controller, errors } = fixture();
				controller.source.value = source;
				await controller.run();
				assert.deepEqual(errors, [], source);
			}
		});
	}
});
