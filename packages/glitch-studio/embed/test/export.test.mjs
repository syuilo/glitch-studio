import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { implementation } from './helpers/load.mjs';
import { fixture, parameter, literal } from './helpers/fixture.mjs';

const { preparePortableVisualModule, encodePortableVisualModule, createPortableVisualModuleFiles, createPortableVisualModuleArchive,
	validatePortableParameters, getPortableParameterDefaults, getPortableRenderResolution, fill, image, video } = implementation;
const definitions = { fill, image, video };

// 【配布物は参照素材と使用するシェーダーだけを開始時点の状態で同梱する】
// 外部ファイルのパスやデバイス識別子を配布せず、素材読み込み中の編集で作品が変わるのを防ぐ。
test('collects immutable resources and custom shaders without local paths or devices', async () => {
	const input = fixture();
	input.assets = [{ id: 'image', name: 'image', width: 2, height: 1, fileDataType: 'image/png', fileData: new Blob([new Uint8Array([1, 2, 3])]), sourceFilePath: 'C:/private/image.png' }];
	input.players = [{ id: 'camera', name: 'Camera', sourceType: 'webcam', deviceId: 'private-device' }];
	const node = (id, effectId, staticSettings) => ({ ...input.visualModule.nodes[0], id, effectId,
		params: Object.fromEntries(Object.entries(definitions[effectId]?.paramDefs ?? {}).map(([key, definition]) => [key, structuredClone(definition.defaultValue)])), staticSettings });
	input.visualModule.nodes.unshift(node('image', 'image', { asset: 'image' }), node('camera', 'video', { player: 'camera' }));
	// Imageの静的設定名は実際の定義から取得する。参照を取り落とす変更も検出する。
	input.visualModule.nodes[0].staticSettings = { [Object.keys(image.staticSettingDefs)[0]]: 'image' };
	input.visualModule.nodes[1].staticSettings = { [Object.keys(video.staticSettingDefs)[0]]: 'camera' };
	const shader = { id: 'shader', name: 'Shader', description: '', shaderApiVersion: 1, codeLanguage: 'wgsl', kind: 'generate', paramDefs: [],
		outputDefs: [{ id: 'output', nameForReference: 'color', label: 'Color', dataType: { kind: 'color' } }], primaryInputId: null, primaryOutputId: 'output', resolutionInputIds: [],
		code: 'fn main(position: vec2f) -> Output { var output: Output; output.color = vec4f(1); return output; }' };
	input.customShaderEffects = [shader, { ...shader, id: 'unused' }];
	input.visualModule.nodes.unshift(node('shader', 'customShaderEffect:shader', {}));
	const prepared = preparePortableVisualModule(input, definitions);
	input.visualModule.nodes[0].displayName = 'changed';
	shader.code = 'changed';
	const encoded = await encodePortableVisualModule(prepared);
	assert.deepEqual(prepared.diagnostics.players, ['Camera']);
	assert.equal(encoded.assets[0].fileDataBase64, 'AQID');
	assert.equal(encoded.customShaderEffects.length, 1);
	assert.notEqual(encoded.customShaderEffects[0].code, 'changed');
	assert.notEqual(encoded.visualModule.nodes[0].displayName, 'changed');
	assert.doesNotMatch(JSON.stringify(encoded), /private-device|C:\/private/);
});

// 【公開値は型とコンテナに従って検証し、HDRや参照名の大小文字を保持する】
// 途中までの更新・呼び出し元からの参照変更・編集用BindingのAPI漏出を防ぐ。
test('validates public values atomically while preserving HDR colors and nested containers', () => {
	const scalar = parameter('scalar', 1, 'Speed');
	const color = parameter('color', [0, 0, 0, 1], 'Color');
	const array = { ...parameter('array', [], 'Points'), dataType: { kind: 'array', elementType: { kind: 'vector' } }, element: { defaultValue: literal([0, 0]) }, maxElements: 2,
		ui: { label: 'Points', control: { element: {} } } };
	array.defaultValue = literal([{ id: 'internal-id', binding: literal([0.1, 0.2]) }]);
	const defs = [scalar, color, array];
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
	const artwork = await encodePortableVisualModule(preparePortableVisualModule(input, definitions));
	const runtime = { elementSource: 'const GlitchStudioVisualModuleEmbed = { registerVisualModuleElement: capture };', workerSource: '// </script> and unicode 日本語' };
	const files = createPortableVisualModuleFiles(artwork, runtime, 'gs-visual-module-test');
	const script = files.standaloneHtml.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
	let captured;
	runInNewContext(script, { capture: (...args) => { captured = args; } });
	assert.equal(captured[1].name, input.name);
	assert.equal(captured[2], runtime.workerSource);
	assert.equal((files.standaloneHtml.match(/<script /g) ?? []).length, 1);
	const zip = new Uint8Array(await createPortableVisualModuleArchive(files).arrayBuffer());
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
	input.visualModule.outputDefs[0].dataType = { kind: 'scalar' };
	assert.throws(() => preparePortableVisualModule(input, definitions), /primary color output/);
	const cyclic = fixture();
	cyclic.visualModule.nodes.unshift({ id: 'relay', type: 'relay', dataType: { kind: 'color' }, input: { nodeId: 'relay', outputPort: 'output' } });
	assert.throws(() => preparePortableVisualModule(cyclic, definitions), /cycle/);
});
