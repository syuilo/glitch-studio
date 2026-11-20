import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { implementation } from './helpers/load.mjs';
import { fixture, parameter, shaderDefinition } from './helpers/fixture.mjs';

const { preparePortableCustomNodeGraphEffect, encodePortableCustomNodeGraphEffect, createPortableCustomNodeGraphEffectFiles, createPortableCustomNodeGraphEffectArchive,
	getPortableParameterDefinitions, validatePortableParameters, getPortableParameterDefaults, getPortableRenderResolution, fill, image, video } = implementation;
const definitions = { fill, image, video };

// 【入れ子のPlayer既定値はWeb Componentの公開値では未選択になる】
// 書き出し時には参照を報告する。配布先ではPlayerを解決できないため、配列と構造体を保ったまま音声入力をnullにする。
test('exports nested audio defaults as unselected public values', () => {
	const input = fixture();
	const audioSource = parameter('audioSource', null, 'Audio');
	const selectedPlayer = { type: 'player', playerId: 'mic' };
	input.players = [{ id: 'mic', name: 'Microphone', sourceType: 'microphone', deviceId: 'private-device' }];
	input.customNodeGraphEffect.paramDefs.tracksId = {
		...parameter('array', [{ audio: selectedPlayer }], 'tracks'),
		dataType: { kind: 'array', elementType: { kind: 'struct', fields: { audio: audioSource.dataType } } },
		ui: { label: 'Tracks', control: { element: { fields: { audio: audioSource.ui } } } },
		element: { defaultValue: { audio: null }, fields: { audio: { defaultValue: null } } },
	};
	const prepared = preparePortableCustomNodeGraphEffect(input, definitions);
	assert.deepEqual(prepared.diagnostics.players, ['Microphone']);
	const parameterDefinitions = getPortableParameterDefinitions(prepared.customNodeGraphEffect);
	assert.deepEqual(getPortableParameterDefaults(parameterDefinitions).tracks, [{ audio: null }]);
	assert.throws(() => validatePortableParameters(parameterDefinitions, { tracks: [{ audio: selectedPlayer }] }), /Invalid audioSource/);
});

// 【配布物は参照素材と使用するシェーダーだけを開始時点の状態で同梱する】
// 外部ファイルのパスやデバイス識別子を配布せず、素材読み込み中の編集で作品が変わるのを防ぐ。
test('collects immutable resources and custom shaders without local paths or devices', async () => {
	const input = fixture();
	input.assets = [{ id: 'image', name: 'image', width: 2, height: 1, fileDataType: 'image/png', fileData: new Blob([new Uint8Array([1, 2, 3])]), sourceFilePath: 'C:/private/image.png' }];
	input.players = [{ id: 'camera', name: 'Camera', sourceType: 'webcam', deviceId: 'private-device' }];
	const child = fixture().customNodeGraphEffect;
	child.nodes.push(
		{ id: 'image', effectSource: { type: 'nativeEffect', id: 'image' }, params: {}, staticSettings: { [Object.keys(image.staticSettingDefs)[0]]: 'image' } },
		{ id: 'camera', effectSource: { type: 'nativeEffect', id: 'video' }, params: {}, staticSettings: { [Object.keys(video.staticSettingDefs)[0]]: 'camera' } },
		{ id: 'shader', effectSource: { type: 'customShaderEffectReference', id: 'shared-id' }, params: {} },
	);
	const shader = shaderDefinition('fn main(position: vec2f) -> Output { return Output(vec4f(1)); }');
	input.customShaderEffects = [{ id: 'shared-id', name: 'Shader', summary: '', definition: shader }, { id: 'unused', definition: shader }];
	input.customNodeGraphEffects = [{ id: 'shared-id', name: 'Child', definition: child, nodeMetadata: { fill: { displayName: 'editor-only' } } },
		{ id: 'unused', definition: child }];
	input.customNodeGraphEffect.nodes[0] = { id: 'fill', effectSource: { type: 'customNodeGraphEffectReference', id: 'shared-id' }, params: {} };
	const prepared = preparePortableCustomNodeGraphEffect(input, definitions);
	input.customNodeGraphEffect.nodes[0].id = 'changed';
	shader.code = 'changed';
	const encoded = await encodePortableCustomNodeGraphEffect(prepared);
	assert.deepEqual(prepared.diagnostics.players, ['Camera']);
	assert.equal(encoded.assets[0].fileDataBase64, 'AQID');
	assert.equal(encoded.customShaderEffects.length, 1);
	assert.notEqual(encoded.customShaderEffects[0].definition.code, 'changed');
	assert.equal(encoded.customNodeGraphEffect.nodes[0].id, 'fill');
	assert.deepEqual(encoded.customNodeGraphEffects.map(entry => entry.id), ['shared-id']);
	assert.deepEqual(prepared.runtimeRequirements, { effectIds: ['fill', 'image', 'video'], requiresExpressions: true, requiresCustomShaderEffects: true });
	assert.doesNotMatch(JSON.stringify(encoded), /editor-only|private-device|C:\/private/);
});

// 【公開値は型とコンテナに従って検証し、HDRや参照名の大小文字を保持する】
// 途中までの更新・呼び出し元からの参照変更・編集用BindingのAPI漏出を防ぐ。
test('validates public values atomically while preserving HDR colors and nested containers', () => {
	const scalar = parameter('scalar', 1, 'Speed');
	const color = parameter('color', [0, 0, 0, 1], 'Color');
	const array = { ...parameter('array', [], 'Points'), dataType: { kind: 'array', elementType: { kind: 'vector' } }, element: { defaultValue: [0, 0] }, maxElements: 2,
		ui: { label: 'Points', control: { element: {} } } };
	array.defaultValue = [[0.1, 0.2]];
	const defs = getPortableParameterDefinitions({ paramDefs: { speedId: scalar, colorId: color, arrayId: array } });
	assert.deepEqual(getPortableParameterDefaults(defs).Points, [[0.1, 0.2]]);
	const values = { Speed: 2, Color: [-1, 3, 0.25, 0.5], Points: [[0.2, -0.1]] };
	const validated = validatePortableParameters(defs, values);
	values.Color[0] = 123;
	assert.equal(validated.Color[0], -1);
	assert.throws(() => validatePortableParameters(defs, { Speed: 3, Color: [1, 1, 1, 2] }), /Invalid color/);
	assert.throws(() => validatePortableParameters(defs, { Speed: Infinity }), /Invalid scalar/);
	assert.throws(() => validatePortableParameters(defs, { speed: 1 }), /Unknown/);
	assert.throws(() => validatePortableParameters(defs, { Points: [[0, 0], [0, 0], [0, 0]] }), /Invalid array/);
});

// 【レスポンシブ解像度は画素数・GPU上限で等方的に縮小する】
// 幅だけのclampや0サイズのGPU確保は座標の歪みやデバイスエラーにつながる。
test('preserves aspect ratio under scale pixel and device limits', () => {
	const settings = { resolutionScale: 1, maxPixels: 500000, fpsLimit: 60 };
	assert.deepEqual(getPortableRenderResolution(2000, 1000, settings), { width: 1000, height: 500 });
	assert.deepEqual(getPortableRenderResolution(2000, 1000, settings, 600), { width: 600, height: 300 });
	assert.equal(getPortableRenderResolution(0, 100, settings), null);
	assert.deepEqual(getPortableRenderResolution(1000, 1, { ...settings, maxPixels: 1 }), { width: 1, height: 1 });
});

// 【HTMLの終端に似た作品データを実行コードとして解釈しない】
// 作品名・文字エフェクトにscriptやHTMLコメントが含まれても、単一HTMLが途中で切れないことを確認する。
test('round trips script-like strings through standalone HTML without executing artwork data', async () => {
	const input = fixture();
	input.name = '</script><script>throw 123</script><!--';
	const artwork = await encodePortableCustomNodeGraphEffect(preparePortableCustomNodeGraphEffect(input, definitions));
	const runtime = { elementSource: 'const GlitchStudioCustomNodeGraphEffectEmbed = { registerCustomNodeGraphEffectElement: capture };', workerSource: '// </script> and unicode 日本語' };
	const files = createPortableCustomNodeGraphEffectFiles(artwork, runtime, 'gs-custom-node-graph-effect-test');
	const script = files.standaloneHtml.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
	let captured;
	runInNewContext(script, { capture: (...args) => { captured = args; } });
	assert.equal(captured[1].name, input.name);
	assert.equal(captured[2], runtime.workerSource);
	assert.equal((files.standaloneHtml.match(/<script /g) ?? []).length, 1);
	const zip = new Uint8Array(await createPortableCustomNodeGraphEffectArchive(files).arrayBuffer());
	const view = new DataView(zip.buffer);
	let offset = 0;
	for (const expected of ['index.html', 'artwork.js', 'README.md']) {
		assert.equal(view.getUint32(offset, true), 0x04034b50);
		const size = view.getUint32(offset + 18, true);
		const length = view.getUint16(offset + 26, true);
		assert.equal(new TextDecoder().decode(zip.subarray(offset + 30, offset + 30 + length)), expected);
		offset += 30 + length + size;
	}
	assert.equal(view.getUint32(offset, true), 0x02014b50);
	assert.equal(view.getUint32(zip.length - 22, true), 0x06054b50);
});

// 【素材不足・循環・表示できない出力はダウンロード前に報告する】
// 壊れた成果物を配布先で初めて発見することを避け、編集すべき箇所を明示する。
test('rejects invalid output and cyclic graphs before encoding', () => {
	const input = fixture();
	input.customNodeGraphEffect.outputSources = {};
	input.customNodeGraphEffect.outputDefs.output.dataType = { kind: 'scalar' };
	assert.throws(() => preparePortableCustomNodeGraphEffect(input, definitions), /primary color output/);
	const cyclic = fixture();
	cyclic.customNodeGraphEffect.nodes.unshift({ id: 'relay', type: 'relay', dataType: { kind: 'color' }, input: { nodeId: 'relay', outputPort: 'output' } });
	assert.throws(() => preparePortableCustomNodeGraphEffect(cyclic, definitions), /Cyclic/);
});

// 【配列長が変わるまで公開入力の束縛を再利用し、未使用の配列を配置の寿命から切り離す】
// 同じ長さの更新で配置を破棄するとFeedbackの履歴が失われる。入れ子の可変長配列についても判定する。
test('reuses bound inputs until a used nested array changes length', () => {
	const samples = { ...parameter('array', [], 'samples'), dataType: { kind: 'array', elementType: { kind: 'vector' } },
		element: { defaultValue: [0, 0], canNode: true }, ui: { label: 'Samples', control: { element: {} } } };
	const field = { ...parameter('struct', { samples: [] }, 'field'), dataType: { kind: 'struct', fields: { samples: samples.dataType } },
		fields: { samples }, ui: { label: 'Field', control: { fields: { samples: samples.ui } } } };
	const bound = implementation.createPortableEffectInputs({ settings: field, unused: { ...samples, nameForReference: 'unused' } },
		{ field: { samples: [[1, 2]] }, unused: [] });
	const input = bound.inputs.settings.fields.samples.elements[0];
	assert.deepEqual(input.value, [1, 2]);
	assert.equal(bound.update({ field: { samples: [[3, 4]] }, unused: [[0, 0]] }), true);
	assert.deepEqual(input.value, [3, 4]);
	assert.equal(bound.update({ field: { samples: [] }, unused: [] }), false);
});
