import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadSource } from './helpers/load-source.mjs';

const load = name => loadSource(fileURLToPath(new URL('../src/' + name, import.meta.url)));
const { getTimelineSoloState } = await load('solo.ts');
const { getTimelineRenderLayers } = await load('layer-tree.ts');
const { getSceneAudioClips } = await load('scene-audio.ts');
const { getActiveTimelineCamera } = await load('scene-camera.ts');
const { getTimelineMotionBlurBoundaries } = await load('motion-blur.ts');
const { getSceneDuration } = await load('scenes.ts');
const { getTimelineLayerOutputDependencyGraph } = await load('layer-output.ts');
const { findDependencyCycle } = await loadSource(fileURLToPath(import.meta.resolve('@gs/shared/utility/dependency-cycle.ts')));
const literal = value => ({ inputSource: 'literal', value });
const clip = () => ({ id: 'clip', startMs: 100, durationMs: 400, contentOffsetMs: 0 });
const image = (id, settings = {}) => ({ id, name: id, layerType: 'image', isDisabled: false, isSolo: false,
	isIncludedInComposite: true, clips: [clip()], ...settings });
const sound = (id, settings = {}) => ({ id, name: id, layerType: 'audio', isDisabled: false, isSolo: false,
	automationGraphs: [], audioParamValues: { volume: literal(0.8) }, clips: [{ ...clip(), assetId: id, sourceInMs: 0, sourceOutMs: 400, playbackRate: 1, loop: false }], ...settings });
const container = (id, layers, settings = {}) => ({ id, name: id, layerType: 'group', isDisabled: false, isSolo: false,
	isIncludedInComposite: true, layers, automationGraphs: [], audioParamValues: { volume: literal(0.5) }, ...settings });
const scene = (id, layers) => ({ id, name: id, resolution: { mode: 'project' }, layers });
const outputIds = layers => [...getTimelineSoloState(layers).layers].filter(([, state]) => state.isOutputEnabled).map(([id]) => id);

// 【ソロなしでは通常表示を保ち、複数ソロでは元の非表示設定を変えず対象だけを出力する】
// 元の状態を直接書き換えると、解除時に編集前の表示設定へ戻せなくなる。
// クリップのないソロもモードを維持し、空白区間で他のレイヤーが突然表示されることを防ぐ。
test('overrides visibility for multiple solo layers and restores normal output without mutating data', () => {
	const layers = [image('shown'), image('hidden', { isDisabled: true }), image('empty', { clips: [] })];
	assert.equal(getTimelineSoloState(layers).hasSolo, false);
	assert.deepEqual(outputIds(layers), ['shown', 'empty']);
	layers[1].isSolo = true;
	layers[2].isSolo = true;
	const saved = structuredClone(layers);
	assert.deepEqual(outputIds(layers), ['hidden', 'empty']);
	assert.deepEqual(layers, saved);
	assert.equal(getTimelineSoloState(layers).layers.get('shown').isEnabled, true);
	layers[1].isSolo = false;
	layers[2].isSolo = false;
	assert.deepEqual(outputIds(layers), ['shown', 'empty']);
});

// 【非表示の祖先を通って子をソロ表示し、兄弟の出力と元の無効状態を維持する】
// Folderは合成境界を作らないため、親だけを有効化しても兄弟が漏れない必要がある。
// GroupやTransformの設定は残し、選択した子だけがその処理を受ける。
test('opens disabled ancestor paths while suppressing siblings through every container type', () => {
	for (const layerType of ['group', 'transform', 'folder', 'parameterContainer']) {
		const parent = container('parent', [image('selected', { isSolo: true, isDisabled: true }), image('sibling')], { layerType, isDisabled: true });
		const layers = [parent, image('outside')];
		assert.deepEqual(outputIds(layers), ['parent', 'selected']);
		const activity = getTimelineSoloState(layers).layers;
		assert.equal(activity.get('selected').isIncludedInComposite, true);
		assert.equal(activity.get('sibling').isIncludedInComposite, false);
		assert.equal(getTimelineRenderLayers(layers, activity).some(layer => layer.id === (layerType === 'folder' || layerType === 'parameterContainer' ? 'selected' : 'parent')), true);
		assert.equal(parent.isDisabled, true);
	}
});

// 【グループ自身のソロでは内部の表示設定を保ち、非ソロの参照用グループは内部合成を保つ】
// グループ全体の確認で隠した子まで復活させず、別グループをマスク元に使う経路も壊さない。
test('keeps ordinary child visibility for solo containers and preserves non-solo reference contents', () => {
	const layers = [container('selected', [image('shown'), image('hidden', { isDisabled: true })], { isSolo: true, isDisabled: true }),
		container('reference', [image('mask'), image('hidden-mask', { isDisabled: true })])];
	assert.deepEqual(outputIds(layers), ['selected', 'shown']);
	const activity = getTimelineSoloState(layers).layers;
	assert.equal(activity.get('reference').isIncludedInComposite, false);
	assert.equal(activity.get('mask').isIncludedInComposite, true);
	assert.equal(activity.get('hidden-mask').isEnabled, false);
});

// 【映像のソロは音声も絞り、音声の明示参照は非ソロでも読み出せる】
// 通常ミックスと可視化エフェクトへの参照を同じ無効化で実装すると、音声入力が失われる。
// 子のソロでも祖先の音量を維持し、Sceneの長さは表示設定によらず一定にする。
test('shares solo selection with audio output while retaining direct audio references and ancestor gains', () => {
	const selected = sound('selected', { isDisabled: true, isSolo: true });
	const root = scene('root', [container('parent', [selected, sound('sibling')], { isDisabled: true }), sound('reference')]);
	const duration = getSceneDuration(root);
	const clips = getSceneAudioClips([root], 'root');
	assert.deepEqual(clips.map(clip => clip.sourceId), ['selected']);
	assert.deepEqual(clips[0].gains.map(gain => gain.volume.value), [0.5, 0.8]);
	assert.deepEqual(getSceneAudioClips([root], 'root', { type: 'layer', layerId: 'parent' }).map(clip => clip.sourceId), ['selected']);
	assert.deepEqual(getSceneAudioClips([root], 'root', { type: 'layer', layerId: 'reference' }).map(clip => clip.sourceId), ['reference']);
	assert.equal(getSceneDuration(root), duration);
	root.layers.push(image('visual', { isSolo: true }));
	selected.isSolo = false;
	assert.deepEqual(getSceneAudioClips([root], 'root'), []);
});

// 【ソロ判定はSceneごとに独立し、参照先のソロが親の兄弟を消さない】
// 同じSceneを複数配置できるため、親の選択を子へ流したり子の選択を親へ持ち出したりしない。
test('keeps scene solo scopes independent for nested audio placements', () => {
	const child = scene('child', [sound('child-selected', { isSolo: true, isDisabled: true }), sound('child-other')]);
	const placement = { ...sound('placement'), layerType: 'scene', clips: [{ ...clip(), sceneId: 'child' }] };
	const root = scene('root', [placement, sound('root-other')]);
	assert.equal(getTimelineSoloState(root.layers).hasSolo, false);
	assert.deepEqual(getSceneAudioClips([root, child], 'root').map(clip => clip.sourceId), ['child-selected', 'root-other']);
	root.layers[1].isSolo = true;
	assert.deepEqual(getSceneAudioClips([root, child], 'root').map(clip => clip.sourceId), ['root-other']);
});

// 【カメラはソロの対象にせず、祖先のソロで無効だったカメラを復活させない】
// レイヤーの確認操作で視点が切り替わると、元の構図で調整できなくなる。
test('preserves normal camera selection and disabling while visual layers are soloed', () => {
	const camera = { id: 'camera', layerType: 'camera', clips: [clip()], isDisabled: false, isSolo: false };
	const hiddenCamera = { ...camera, id: 'hidden-camera' };
	const layers = [container('hidden-parent', [hiddenCamera, image('selected', { isSolo: true })], { layerType: 'folder', isDisabled: true }), camera];
	assert.equal(getActiveTimelineCamera(layers, 200).layer.id, 'camera');
	const activity = getTimelineSoloState(layers).layers;
	assert.equal(activity.get('camera').isOutputEnabled, true);
	assert.equal(activity.get('hidden-camera').isOutputEnabled, false);
	assert.equal(getTimelineSoloState([{ ...camera, isSolo: true }]).hasSolo, false);
});

// 【非表示だったソロのクリップ境界もモーションブラーの露光を制限する】
// 評価だけを有効にすると、クリップの開始・終了をまたいで別フレームが混ざってしまう。
test('includes cuts of disabled solo layers in motion blur planning', () => {
	const root = scene('root', [container('parent', [image('selected', { isDisabled: true, isSolo: true })], { isDisabled: true })]);
	assert.deepEqual(getTimelineMotionBlurBoundaries([root], 'root'), [0, 100, 500]);
});

// 【ソロで通常合成の除外を上書きした場合も循環参照を検出する】
// 除外中だけ成立した入力配線をそのまま有効化すると、実行時に互いの画像を待ち続ける。
test('detects dependencies newly activated by soloing an excluded composite', () => {
	const layers = [image('upper'), image('lower', { isIncludedInComposite: false })];
	const inputs = id => id === 'upper' ? [{ inputSource: 'anotherLayerOutput', layerId: 'lower', outputStage: 'composited' }] : [{ inputSource: 'anotherLayerOutput', layerId: 'upper', outputStage: 'source' }];
	assert.equal(findDependencyCycle(getTimelineLayerOutputDependencyGraph(layers, inputs)), null);
	layers[1].isSolo = true;
	assert.notEqual(findDependencyCycle(getTimelineLayerOutputDependencyGraph(layers, inputs)), null);
});
