import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildPortableCustomNodeGraphEffectCatalog } from '../build/catalog.mjs';
import { buildPortableCustomNodeGraphEffectRuntime } from '../build/runtime.mjs';
import { implementation } from './helpers/load.mjs';
import { fixture, literal, parameter } from './helpers/fixture.mjs';

const { analyzePortableCustomNodeGraphEffectRuntime, fill } = implementation;

// 【基準式・有効な加工式・コンテナの子・カスタム値を漏らさず解析する】
// 公開値の変更やCUSTOMの動的参照で後から通る処理もあるため、現在値だけで式を削らない。
// 公開既定値は末端までliteralであり、式はWorkerでのみ評価する。
test('detects expression capabilities in nested bindings, modifiers and custom parameters', () => {
	const resources = fixture();
	const { customNodeGraphEffect } = resources;
	const analyze = () => analyzePortableCustomNodeGraphEffectRuntime(resources, { fill }).runtimeRequirements;
	assert.equal(analyze().requiresExpressions, true);
	customNodeGraphEffect.nodes[0].params.color = literal([1, 0, 0, 1]);
	assert.equal(analyze().requiresExpressions, false);
	customNodeGraphEffect.nodes[0].params.color.expressionModifier = { enabled: false, code: 'VALUE' };
	assert.equal(analyze().requiresExpressions, false);
	customNodeGraphEffect.nodes[0].params.color.expressionModifier.enabled = true;
	assert.equal(analyze().requiresExpressions, true);
	customNodeGraphEffect.nodes[0].params.color = { inputSource: 'envVariable', variable: 'POINTER_POSITION' };
	assert.equal(analyze().requiresExpressions, false);
	const nested = { ...parameter('array', [], 'values'), dataType: { kind: 'array', elementType: { kind: 'scalar' } },
		element: { defaultValue: literal(0) }, ui: { label: 'Values', control: { element: {} } } };
	const nestedGraph = fixture().customNodeGraphEffect;
	nestedGraph.nodes = [];
	nestedGraph.outputSources = {};
	nestedGraph.paramDefs = { values: nested };
	customNodeGraphEffect.nodes.push({ id: 'nested', effectSource: { type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: nestedGraph },
		params: { values: literal([{ id: 'child', binding: { inputSource: 'expression', expression: '1 + 2' } }]) } });
	assert.equal(analyze().requiresExpressions, true);
	customNodeGraphEffect.nodes[1].params = {};
	assert.equal(analyze().requiresExpressions, false);
	customNodeGraphEffect.customParameterDefs = { custom: parameter('scalar', 0, 'custom') };
	customNodeGraphEffect.customParameterValues = { custom: { inputSource: 'expression', expression: 'TIME' } };
	assert.equal(analyze().requiresExpressions, true);
	customNodeGraphEffect.nodes[0].isBypass = true;
	assert.deepEqual(analyze().effectIds, ['fill']);
});

// 【同梱資材だけで作品専用JSを作り、未使用エフェクトとAiScriptを含めない】
// 元のworkspaceを参照しない一時ディレクトリを入力にして、配布アプリでも再ビルドできることを確認する。
// main/workerそれぞれの式依存と、カタログ外のIDを拒否する境界も検証する。
test('bundles only selected runtime capabilities from a self-contained catalog', async t => {
	const temporaryRoot = path.resolve(tmpdir());
	const directory = await mkdtemp(path.join(temporaryRoot, 'glitch-runtime-catalog-'));
	t.after(async () => {
		assert.equal(path.dirname(path.resolve(directory)), temporaryRoot);
		assert.ok(path.basename(directory).startsWith('glitch-runtime-catalog-'));
		await rm(directory, { recursive: true, force: true });
	});
	const catalog = await buildPortableCustomNodeGraphEffectCatalog(directory);
	// 【どのエフェクトにも実行時のWGSL解析器を混入させない】
	// 一部の関数だけのimportでも解析器の初期化が残るため、全カタログの依存から確認する。
	assert.ok(Object.keys(catalog.inputs).every(file => !/webgpu-utils|wgsl_reflect/.test(file)));
	const requirements = { effectIds: ['fill'], requiresExpressions: false, requiresCustomShaderEffects: false };
	const metadata = [];
	const plain = await buildPortableCustomNodeGraphEffectRuntime(directory, requirements, (_name, result) => metadata.push(result));
	assert.doesNotMatch(plain.elementSource + plain.workerSource, /AiScript|VideoSampleSink|Expression is empty|fn gs_fragment/);
	for (const result of metadata) {
		assert.ok(Object.keys(result.inputs).filter(file => file.includes('/effects/')).every(file => file.includes('/effects/fill/')));
		assert.ok(Object.values(result.outputs).every(output => output.imports.length === 0));
	}
	const expressions = await buildPortableCustomNodeGraphEffectRuntime(directory, { ...requirements, requiresExpressions: true });
	assert.match(expressions.workerSource, /Expression is empty/);
	assert.equal(expressions.elementSource, plain.elementSource);
	const shaders = await buildPortableCustomNodeGraphEffectRuntime(directory, { ...requirements, requiresCustomShaderEffects: true });
	assert.match(shaders.workerSource, /fn gs_fragment/);
	assert.doesNotMatch(shaders.workerSource, /Expression is empty/);
	assert.ok(expressions.workerSource.length > plain.workerSource.length + 50000);
	// 【内蔵画像は必要なエフェクトと一緒に同梱する】
	// 公開値から選べる全セットを持ちつつ、Symbolsを使わない作品へ画像を混入させない。
	const symbols = await buildPortableCustomNodeGraphEffectRuntime(directory, { ...requirements, effectIds: ['symbols'] });
	assert.match(symbols.workerSource, /data:image\/png;base64,/);
	assert.doesNotMatch(symbols.workerSource, /BASE_URL/);
	assert.doesNotMatch(plain.elementSource + plain.workerSource, /data:image\/png;base64,/);
	// 【QRコードの符号化依存と利用許諾を、必要な作品のWorkerだけへ同梱する】
	// 配布カタログから再ビルドした単独JSでも、npmの実行時参照や通知の欠落を残さない。
	const qrCode = await buildPortableCustomNodeGraphEffectRuntime(directory, { ...requirements, effectIds: ['qrCode'] });
	assert.match(qrCode.workerSource, /rg8uint/);
	assert.match(qrCode.workerSource, /Copyright \(c\) Project Nayuki/);
	assert.match(qrCode.workerSource, /Permission is hereby granted/);
	assert.doesNotMatch(plain.elementSource + plain.workerSource, /QR encoding: uqr/);
	// 【どの組み込みエフェクトにもIIFE非対応の依存を残さない】
	// 一部の作品だけ成功する回帰を防ぐため、カタログ全体を最終形式までビルドする。
	const { effectIds } = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
	await buildPortableCustomNodeGraphEffectRuntime(directory, { ...requirements, effectIds });
	await assert.rejects(buildPortableCustomNodeGraphEffectRuntime(directory, { ...requirements, effectIds: ['../expression'] }), /Invalid/);
	// 【ビルド時の警告を見落として壊れた成果物を保存しない】
	// 配布カタログへVite専用参照が再混入した場合も、書き出しの段階で明示的に失敗させる。
	await writeFile(path.join(directory, 'worker.js'), 'export function startPortableCustomNodeGraphEffectWorker() { console.log(import.meta.env.BASE_URL); }');
	await assert.rejects(buildPortableCustomNodeGraphEffectRuntime(directory, requirements), error => error.errors?.some(entry => entry.id === 'empty-import-meta'));
	t.diagnostic(`Fill without expressions: element ${plain.elementSource.length} bytes, worker ${plain.workerSource.length} bytes; worker with AiScript: ${expressions.workerSource.length} bytes`);
});
