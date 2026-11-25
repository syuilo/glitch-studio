import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { crc32 } from 'node:zlib';
import { implementation } from './helpers/load.mjs';
import { fixture, parameter, shaderDefinition } from './helpers/fixture.mjs';

const { preparePortableNodesEffect, encodePortableNodesEffect, createPortableNodesEffectFiles, createPortableNodesEffectArchive,
	getPortableParameterDefinitions, getPortableParameterDefaults, getPortableRenderResolution, fill, image } = implementation;
const definitions = { fill, image };

// 【入れ子の音声入力はWeb Componentの公開値でも未接続になる】
// 配列と構造体を保ったまま音声入力の未選択を維持する。
test('exports nested audio defaults as unselected public values', () => {
	const input = fixture();
	const audioSource = parameter('audioSource', null, 'Audio');
	input.nodesEffect.paramDefs.tracksId = {
		...parameter('array', [{ audio: null }], 'tracks'),
		dataType: { kind: 'array', elementType: { kind: 'struct', fields: { audio: audioSource.dataType } } },
		ui: { label: 'Tracks', control: { element: { fields: { audio: audioSource.ui } } } },
		element: { defaultValue: { audio: null }, fields: { audio: { defaultValue: null } } },
	};
	const prepared = preparePortableNodesEffect(input, definitions);
	const parameterDefinitions = getPortableParameterDefinitions(prepared.nodesEffect);
	assert.deepEqual(getPortableParameterDefaults(parameterDefinitions).tracks, [{ audio: null }]);
});

// 【配布物は参照素材と使用するシェーダーだけを開始時点の状態で同梱する】
// 外部ファイルのパスやデバイス識別子を配布せず、素材読み込み中の編集で作品が変わるのを防ぐ。
test('collects immutable resources and custom shaders without local paths or devices', async () => {
	const input = fixture();
	input.assets = [{ id: 'image', name: 'image', width: 2, height: 1, fileDataType: 'image/png', fileData: new Blob([new Uint8Array([1, 2, 3])]), sourceFilePath: 'C:/private/image.png', sourceFileName: 'original.PNG' }];
	const child = fixture().nodesEffect;
	child.nodes.push(
		{ id: 'image', effectSource: { type: 'nativeEffect', id: 'image' }, params: {}, staticSettings: { [Object.keys(image.staticSettingDefs)[0]]: 'image' } },
		{ id: 'shader', effectSource: { type: 'customShaderEffectReference', id: 'shared-id' }, params: {} },
	);
	const shader = shaderDefinition('fn main(position: vec2f) -> Output { return Output(vec4f(1)); }');
	input.customShaderEffects = [{ id: 'shared-id', name: 'Shader', summary: '', definition: shader }, { id: 'unused', definition: shader }];
	input.nodesEffects = [{ id: 'shared-id', name: 'Child', definition: child, nodeMetadata: { fill: { displayName: 'editor-only' } } },
		{ id: 'unused', definition: child }];
	input.nodesEffect.nodes[0] = { id: 'fill', effectSource: { type: 'nodesEffectReference', id: 'shared-id' }, params: {} };
	const prepared = preparePortableNodesEffect(input, definitions);
	input.nodesEffect.nodes[0].id = 'changed';
	shader.code = 'changed';
	const { artwork: encoded } = await encodePortableNodesEffect(prepared, 'html');
	const { artwork: zipped } = await encodePortableNodesEffect(prepared, 'zip');
	assert.equal(encoded.assets[0].fileDataBase64, 'AQID');
	assert.equal(zipped.assets[0].fileDataPath, 'assets/1.PNG');
	assert.doesNotMatch(JSON.stringify(zipped), /original\.PNG|C:\/private/);
	assert.equal(encoded.customShaderEffects.length, 1);
	assert.notEqual(encoded.customShaderEffects[0].definition.code, 'changed');
	assert.equal(encoded.nodesEffect.nodes[0].id, 'fill');
	assert.deepEqual(encoded.nodesEffects.map(entry => entry.id), ['shared-id']);
	assert.deepEqual(prepared.runtimeRequirements, { effectIds: ['fill', 'image'], requiresExpressions: true, requiresCustomShaderEffects: true });
	assert.doesNotMatch(JSON.stringify(encoded), /editor-only|private-device|C:\/private/);
});

// 【Web書き出しでも共有Function Curveと参照IDを同梱する】
// 直接参照だけの作品は式エンジンなしで構成し、加工式からのFUNCTION_CURVE参照は依存判定で拾う。
test('packages shared curves for direct references and detects FUNCTION_CURVE expressions', async () => {
	const input = fixture();
	const curve = { id: 'curve-id', nameForReference: 'ramp', type: 'pulse', dutyCycle: 0.25 };
	const direct = { inputSource: 'curveAnimationInline', curveAnimation: {
		curveBinding: { source: 'reference', curveId: curve.id },
		trimmedDurationMs: 1000, yRangeMin: 10, yRangeMax: 20, offsetMode: 'start', wrapMode: 'clamp',
	} };
	input.nodesEffect.nodes[0].params.color = { inputSource: 'literal', value: [0, 0, 0, 1] };
	input.nodesEffect.functionCurves = [curve];
	input.nodesEffect.customParameterDefs = { motion: parameter('scalar', 0, 'motion') };
	input.nodesEffect.customParameterValues = { motion: direct };
	const prepared = preparePortableNodesEffect(input, definitions);
	assert.equal(prepared.runtimeRequirements.requiresExpressions, false);
	const { artwork } = await encodePortableNodesEffect(prepared, 'html');
	assert.deepEqual(artwork.nodesEffect.functionCurves, [curve]);
	assert.deepEqual(artwork.nodesEffect.customParameterValues.motion, direct);

	input.nodesEffect.customParameterValues.motion = { ...direct, expressionModifier: { enabled: true, code: 'VALUE + FUNCTION_CURVE("ramp", 0, "clamp")' } };
	assert.equal(preparePortableNodesEffect(input, definitions).runtimeRequirements.requiresExpressions, true);
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
	input.nodesEffect.paramDefs = { speedId: scalar, colorId: color, arrayId: array };
	const parameterDefinitions = getPortableParameterDefinitions(input.nodesEffect);
	const defaults = getPortableParameterDefaults(parameterDefinitions);
	assert.deepEqual(defaults.Points, [[0.1, 0.2]]);
	defaults.Points[0][0] = 99;
	assert.deepEqual(array.defaultValue, [[0.1, 0.2]]);
	const values = { Speed: 2, Color: [-1, 3, 0.25, 0.5], Points: [[0.2, -0.1]] };
	input.initialParameters = values;
	const prepared = preparePortableNodesEffect(input, definitions);
	assert.deepEqual(prepared.initialParameters, values);
	values.Color[0] = 123;
	values.Points[0][0] = 99;
	assert.deepEqual(prepared.initialParameters, { Speed: 2, Color: [-1, 3, 0.25, 0.5], Points: [[0.2, -0.1]] });
});

// 【レスポンシブ解像度は画素数・GPU上限で等方的に縮小する】
// 幅だけのclampや0サイズのGPU確保は座標の歪みやデバイスエラーに繋がる。
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
	const artwork = await encodePortableNodesEffect(preparePortableNodesEffect(input, definitions), 'html');
	const runtime = { elementSource: 'const GlitchStudioNodesEffectEmbed = { registerNodesEffectElement: capture };', workerSource: '// </script> and unicode 日本語' };
	const files = createPortableNodesEffectFiles(artwork, runtime, 'gs-nodes-effect-test');
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
	const prepared = preparePortableNodesEffect(fixture(), definitions);
	const originals = [Uint8Array.of(0, 255, 128, 10), Uint8Array.of(254, 0, 13), Uint8Array.of(5, 6)];
	const sourceFileNames = ['画像.PNG', '画像.PNG', 'asset.php'];
	prepared.assets = originals.map((contents, index) => ({ id: `image-${index}`, name: '画像.png',
		sourceFileName: sourceFileNames[index], width: 1, height: 1, fileDataType: 'image/png', fileData: new Blob([contents]) }));
	const encoded = await encodePortableNodesEffect(prepared, 'zip');
	const assetPaths = ['assets/1.PNG', 'assets/2.PNG', 'assets/3.bin'];
	assert.deepEqual(encoded.artwork.assets.map(asset => asset.fileDataPath), assetPaths);
	assert.ok(encoded.artwork.assets.every(asset => asset.fileDataType === 'image/png'));
	assert.ok(encoded.artwork.assets.every(asset => !('fileDataBase64' in asset)));
	const files = createPortableNodesEffectFiles(encoded, { elementSource: '', workerSource: '' });
	const zip = new Uint8Array(await (await createPortableNodesEffectArchive(files)).arrayBuffer());
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
test('rejects invalid output and cyclic Nodes Effect references before encoding', () => {
	const input = fixture();
	input.nodesEffect.outputSources = {};
	input.nodesEffect.outputDefs.output.dataType = { kind: 'scalar' };
	assert.throws(() => preparePortableNodesEffect(input, definitions), /primary color output/);
	const cyclic = fixture();
	cyclic.nodesEffect.nodes.unshift({ id: 'relay', type: 'relay', dataType: { kind: 'color' }, input: { nodeId: 'relay', outputPort: 'output' } });
	assert.throws(() => preparePortableNodesEffect(cyclic, definitions), /Cyclic/);
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
