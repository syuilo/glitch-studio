import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { crc32 } from 'node:zlib';
import { implementation } from './helpers/load.mjs';
import { fixture, parameter, shaderDefinition } from './helpers/fixture.mjs';

const { preparePortableCustomNodeGraphEffect, encodePortableCustomNodeGraphEffect, createPortableCustomNodeGraphEffectFiles, createPortableCustomNodeGraphEffectArchive,
	getPortableParameterDefinitions, getPortableParameterDefaults, getPortableRenderResolution, fill, image, video } = implementation;
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
});

// 【配布物は参照素材と使用するシェーダーだけを開始時点の状態で同梱する】
// 外部ファイルのパスやデバイス識別子を配布せず、素材読み込み中の編集で作品が変わるのを防ぐ。
test('collects immutable resources and custom shaders without local paths or devices', async () => {
	const input = fixture();
	input.assets = [{ id: 'image', name: 'image', width: 2, height: 1, fileDataType: 'image/png', fileData: new Blob([new Uint8Array([1, 2, 3])]), sourceFilePath: 'C:/private/image.png', sourceFileName: 'original.PNG' }];
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
	const { artwork: encoded } = await encodePortableCustomNodeGraphEffect(prepared, 'html');
	const { artwork: zipped } = await encodePortableCustomNodeGraphEffect(prepared, 'zip');
	assert.deepEqual(prepared.diagnostics.players, ['Camera']);
	assert.equal(encoded.assets[0].fileDataBase64, 'AQID');
	assert.equal(zipped.assets[0].fileDataPath, 'assets/1.PNG');
	assert.doesNotMatch(JSON.stringify(zipped), /original\.PNG|C:\/private/);
	assert.equal(encoded.customShaderEffects.length, 1);
	assert.notEqual(encoded.customShaderEffects[0].definition.code, 'changed');
	assert.equal(encoded.customNodeGraphEffect.nodes[0].id, 'fill');
	assert.deepEqual(encoded.customNodeGraphEffects.map(entry => entry.id), ['shared-id']);
	assert.deepEqual(prepared.runtimeRequirements, { effectIds: ['fill', 'image', 'video'], requiresExpressions: true, requiresCustomShaderEffects: true });
	assert.doesNotMatch(JSON.stringify(encoded), /editor-only|private-device|C:\/private/);
});

// 【公開値のHDR・入れ子・参照名を保持し、書き出し元から独立した値を作る】
// 書き出しの非同期処理中に元の値が編集されても、準備済みの作品や公開既定値に影響させない。
test('preserves HDR colors and nested public values in independent export snapshots', () => {
	const scalar = parameter('scalar', 1, 'Speed');
	const color = parameter('color', [0, 0, 0, 1], 'Color');
	const array = { ...parameter('array', [], 'Points'), dataType: { kind: 'array', elementType: { kind: 'vector' } }, element: { defaultValue: [0, 0] }, maxElements: 2,
		ui: { label: 'Points', control: { element: {} } } };
	array.defaultValue = [[0.1, 0.2]];
	const input = fixture();
	input.customNodeGraphEffect.paramDefs = { speedId: scalar, colorId: color, arrayId: array };
	const parameterDefinitions = getPortableParameterDefinitions(input.customNodeGraphEffect);
	const defaults = getPortableParameterDefaults(parameterDefinitions);
	assert.deepEqual(defaults.Points, [[0.1, 0.2]]);
	defaults.Points[0][0] = 99;
	assert.deepEqual(array.defaultValue, [[0.1, 0.2]]);
	const values = { Speed: 2, Color: [-1, 3, 0.25, 0.5], Points: [[0.2, -0.1]] };
	input.initialParameters = values;
	const prepared = preparePortableCustomNodeGraphEffect(input, definitions);
	assert.deepEqual(prepared.initialParameters, values);
	values.Color[0] = 123;
	values.Points[0][0] = 99;
	assert.deepEqual(prepared.initialParameters, { Speed: 2, Color: [-1, 3, 0.25, 0.5], Points: [[0.2, -0.1]] });
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
	const artwork = await encodePortableCustomNodeGraphEffect(preparePortableCustomNodeGraphEffect(input, definitions), 'html');
	const runtime = { elementSource: 'const GlitchStudioCustomNodeGraphEffectEmbed = { registerCustomNodeGraphEffectElement: capture };', workerSource: '// </script> and unicode 日本語' };
	const files = createPortableCustomNodeGraphEffectFiles(artwork, runtime, 'gs-custom-node-graph-effect-test');
	const script = files.html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
	let captured;
	runInNewContext(script, { capture: (...args) => { captured = args; } });
	assert.equal(captured[1].name, input.name);
	assert.equal(captured[2], runtime.workerSource);
	assert.equal((files.html.match(/<script /g) ?? []).length, 1);
});

// 【ZIPには各Assetの原本を独立したファイルとして格納する】
// 表示名が重複しても参照先を区別し、テキスト変換で素材のバイト列が変わらないことを検証する。
test('stores original binary assets under distinct paths with valid ZIP checksums', async () => {
	const prepared = preparePortableCustomNodeGraphEffect(fixture(), definitions);
	const originals = [Uint8Array.of(0, 255, 128, 10), Uint8Array.of(254, 0, 13), Uint8Array.of(5, 6)];
	const sourceFileNames = ['画像.PNG', '画像.PNG', 'asset.php'];
	prepared.assets = originals.map((contents, index) => ({ id: `image-${index}`, name: '画像.png',
		sourceFileName: sourceFileNames[index], width: 1, height: 1, fileDataType: 'image/png', fileData: new Blob([contents]) }));
	const encoded = await encodePortableCustomNodeGraphEffect(prepared, 'zip');
	const assetPaths = ['assets/1.PNG', 'assets/2.PNG', 'assets/3.bin'];
	assert.deepEqual(encoded.artwork.assets.map(asset => asset.fileDataPath), assetPaths);
	assert.ok(encoded.artwork.assets.every(asset => asset.fileDataType === 'image/png'));
	assert.ok(encoded.artwork.assets.every(asset => !('fileDataBase64' in asset)));
	const files = createPortableCustomNodeGraphEffectFiles(encoded, { elementSource: '', workerSource: '' });
	const zip = new Uint8Array(await (await createPortableCustomNodeGraphEffectArchive(files)).arrayBuffer());
	const view = new DataView(zip.buffer);
	let offset = 0;
	const paths = ['index.html', 'artwork.js', 'README.md', ...assetPaths];
	const localOffsets = [];
	for (const [index, expected] of paths.entries()) {
		localOffsets.push(offset);
		assert.equal(view.getUint32(offset, true), 0x04034b50);
		assert.equal(view.getUint16(offset + 8, true), 0);
		const size = view.getUint32(offset + 18, true);
		const length = view.getUint16(offset + 26, true);
		const dataOffset = offset + 30 + length;
		assert.equal(new TextDecoder().decode(zip.subarray(offset + 30, dataOffset)), expected);
		const contents = zip.subarray(dataOffset, dataOffset + size);
		assert.equal(view.getUint32(offset + 14, true), crc32(contents));
		if (index >= 3) assert.deepEqual(contents, originals[index - 3]);
		offset = dataOffset + size;
	}
	const directoryOffset = offset;
	for (const localOffset of localOffsets) {
		assert.equal(view.getUint32(offset, true), 0x02014b50);
		assert.equal(view.getUint32(offset + 42, true), localOffset);
		offset += 46 + view.getUint16(offset + 28, true);
	}
	assert.equal(offset, zip.length - 22);
	assert.equal(view.getUint32(offset, true), 0x06054b50);
	assert.equal(view.getUint16(offset + 10, true), paths.length);
	assert.equal(view.getUint32(offset + 16, true), directoryOffset);
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
