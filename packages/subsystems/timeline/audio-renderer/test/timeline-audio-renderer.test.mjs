import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const bundle = await build({ stdin: {
	contents: `export { TimelineAudioRenderer } from './timeline-audio-renderer.ts';
		export { getSceneAudioClips } from '@gs/subsystems_timeline_shared/scene-audio.ts';`,
	resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), loader: 'ts',
}, bundle: true, platform: 'node', format: 'cjs', write: false });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { TimelineAudioRenderer, getSceneAudioClips } = module.exports;
const layer = (changes = {}) => ({ id: 'audio', layerType: 'audio', name: 'Layer', isDisabled: false, clips: [{ id: 'clip', startMs: 100, sourceInMs: 20, sourceOutMs: 120, playbackRate: 1, loop: false, durationMs: 100, assetId: 'asset' }], audioParamValues: { volume: { inputSource: 'literal', value: 1 } }, automationGraphs: [], ...changes });

function renderSceneAudio(renderer, layers, ...args) {
	const scene = { id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers };
	return renderer.renderClips(getSceneAudioClips([scene], scene.id), ...args);
}

// 【動画の音量はScene時刻で評価し、素材時刻は独立して読み出す】
// 音量キーを素材時刻へずらすと、クリップの移動やトリムでレイヤーの設定が変わってしまう。
// PCMは同じ素材時刻で読み、音声だけを先頭へ詰め直さない。
test('uses scene time for video volume without shifting audio timestamps', async () => {
	const calls = [];
	const renderer = new TimelineAudioRenderer(async (...args) => { calls.push(args.slice(0, 4)); return constant(...args); });
	const clip = { sourceId: 'movie', sourceTiming: { startMs: 8000, sourceInMs: 0, sourceOutMs: 11000 - (8000), playbackRate: 1, loop: false }, startMs: 10000, endMs: 11000, gains: [{ sceneStartMs: 0, volume: { inputSource: 'expression', expression: 'TIME_MS / 20000' }, automationGraphs: [] }] };
	const result = await renderer.renderClips([clip], 10000, 1, 1000);
	assert.deepEqual(calls, [['movie', 2, 1, 1000]]);
	assert.equal(result[0][0], 0.5);
});
const constant = async (_id, _time, frames) => [new Float32Array(frames).fill(1), new Float32Array(frames).fill(0.5)];

// 【祖先のカスタムパラメータを音量へ接続し、参照の奥のholdキーもサンプル境界で切り替える】
// 200Hzの制御値補間へ丸めると、短いキーの切り替えが映像とずれ、チャンクによって音が変わってしまう。
test('evaluates ancestor custom gain keyframes without smoothing hold boundaries', async () => {
	const definition = { id: 'gain', nameForReference: 'gain', dataType: { kind: 'scalar' }, ui: { label: 'Gain', control: { controlType: 'number' } }, defaultValue: { inputSource: 'literal', value: 1 } };
	const sound = layer({ clips: [{ id: 'clip', startMs: 0, durationMs: 10, sourceInMs: 0, sourceOutMs: 10, playbackRate: 1, loop: false, assetId: 'asset' }],
		customParameterDefs: [{ ...definition, id: 'forward' }],
		customParameterValues: { forward: { inputSource: 'timelineLayerCustomParameterReference', layerId: 'transform', parameterId: 'gain' } },
		audioParamValues: { volume: { inputSource: 'expression', expression: 'PARAM("gain")' } },
	});
	const transform = { id: 'transform', name: 'Transform', layerType: 'transform', isDisabled: false, layers: [sound], automationGraphs: [],
		customParameterDefs: [definition], customParameterValues: { gain: { inputSource: 'keyframesTimelineInline', offsetMode: 'start', wrapMode: 'clamp', trimmedDurationMs: null,
			keyframesTimeline: { dataType: { kind: 'scalar' }, isNormalized: false, keyframes: [
				{ id: 'first', x: 0, value: 0.25, interpolation: { type: 'hold' } },
				{ id: 'second', x: 3, value: 0.75, interpolation: { type: 'hold' } },
			] } } },
	};
	const renderer = new TimelineAudioRenderer(constant);
	const complete = await renderSceneAudio(renderer, [transform], 0, 10, 1000);
	assert.deepEqual([...complete[0]], [0.25, 0.25, 0.25, 0.75, 0.75, 0.75, 0.75, 0.75, 0.75, 0.75]);
	const partial = await renderSceneAudio(renderer, [transform], 2, 4, 1000, true);
	assert.deepEqual([...partial[0]], [...complete[0].slice(2, 6)]);
});

// 【参照先Sceneは親Sceneのカスタムパラメータを暗黙に継承せず、所属Sceneの時計で評価する】
// 同じSceneの複数配置が呼び出し側の値を共有してしまわないよう、音声計画にも境界を保持する。
test('keeps custom gain scope inside its owning scene across repeated placements', async () => {
	const definition = { id: 'gain', nameForReference: 'gain', dataType: { kind: 'scalar' }, ui: { label: 'Gain', control: { controlType: 'number' } }, defaultValue: { inputSource: 'literal', value: 1 } };
	const sound = layer({ clips: [{ id: 'clip', startMs: 0, durationMs: 100, sourceInMs: 0, sourceOutMs: 100, playbackRate: 1, loop: false, assetId: 'asset' }], customParameterDefs: [definition], customParameterValues: { gain: { inputSource: 'expression', expression: 'TIME_MS / 100' } }, audioParamValues: { volume: { inputSource: 'expression', expression: 'PARAM("gain")' } } });
	const placement = startMs => ({ id: `placement-${startMs}`, name: 'Placement', layerType: 'scene', isDisabled: false, automationGraphs: [], customParameterDefs: [definition], customParameterValues: { gain: { inputSource: 'literal', value: 99 } }, audioParamValues: { volume: { inputSource: 'literal', value: 1 } }, clips: [{ id: 'clip', startMs, durationMs: 100, contentOffsetMs: 0, sceneId: 'child' }] });
	const scenes = [{ id: 'root', layers: [placement(0), placement(100)] }, { id: 'child', layers: [sound] }];
	const renderer = new TimelineAudioRenderer(constant);
	const clips = getSceneAudioClips(scenes, 'root');
	const output = await renderer.renderClips(clips, 50, 1, 1000);
	const repeated = await renderer.renderClips(clips, 150, 1, 1000, true);
	assert.equal(output[0][0], 0.5);
	assert.equal(repeated[0][0], 0.5);
	assert.equal(clips[0].gains.at(-1).customParameters.ancestors.length, 0);
});

// 【小数オフセットの演算誤差でループ境界を1サンプル遅らせない】
// 1000/3msをトリムした子Sceneでは、境界のサンプル位置が32000の直後へ丸まり得る。
// そこを単純に切り上げると前の周の範囲外を読むため、整数境界の誤差だけを吸収する。
test('does not read an extra sample across a fractional scene loop boundary', async () => {
	const calls = [];
	const renderer = new TimelineAudioRenderer(async (...args) => { calls.push(args.slice(0, 4)); return constant(...args); });
	const clip = { sourceId: 'movie', sourceTiming: { startMs: -1000 / 3, sourceInMs: 20, sourceOutMs: 1020, playbackRate: 1, loop: true }, startMs: 0, endMs: 2000, gains: [] };
	await renderer.renderClips([clip], 31990, 20, 48000);
	assert.deepEqual(calls.map(call => call[2]), [10, 10]);
	assert.ok(Math.abs(calls[1][1] - 0.02) < 1e-12);
});

// 【ループ境界を跨ぐ読み出しを分割し、最後の端数周とScene時刻の音量を保つ】
// 一度のPCM読み出しで素材終端へ進んだり、音量まで周期ごとに戻ったりしてはいけない。
// プレビュー・書き出し・途中シークでも同じ配置計画から同じ値を得る。
test('splits video audio at loop boundaries while preserving scene-time gain', async () => {
	const video = layer({ layerType: 'video', compositingParamValues: {},
		clips: [{ id: 'clip', startMs: 100, sourceInMs: 20, sourceOutMs: 50, playbackRate: 1, loop: true, durationMs: 85, assetId: 'movie', audioEnabled: true, videoEnabled: true }],
		audioParamValues: { volume: { inputSource: 'expression', expression: 'TIME_MS / 1000' } } });
	for (const isExport of [false, true]) {
		const calls = [];
		const renderer = new TimelineAudioRenderer(async (...args) => { calls.push(args.slice(0, 4)); return constant(...args); });
		const output = await renderSceneAudio(renderer, [video], 125, 70, 1000, isExport);
		assert.deepEqual(calls, [['movie', 0.045, 5, 1000], ['movie', 0.02, 30, 1000], ['movie', 0.02, 25, 1000]]);
		assert.equal(output[0][5], Math.fround(0.13));
		assert.equal(output[0][35], Math.fround(0.16));
		assert.deepEqual([...output[0].slice(60)], Array(10).fill(0));
	}
});

// 【整数サンプル数にならない周期でも、チャンク長や周回数によって位相をずらさない】
// 44.1kHzの1msは44.1サンプルであり、44サンプルへ丸めた周期の累積は許可しない。
// 素材位置を信号値として返すことで、境界で読み出しを分割しただけの実装でも位相の誤りを検出する。
test('keeps fractional-sample loop periods aligned across arbitrary chunks', async () => {
	const renderer = new TimelineAudioRenderer(async (_id, time, frames, rate) => {
		const channel = Float32Array.from({ length: frames }, (_, index) => time + index / rate);
		return [channel, channel];
	});
	const clip = { sourceId: 'movie', sourceTiming: { startMs: -0.25, sourceInMs: 50.25, sourceOutMs: 51.25, playbackRate: 1, loop: true }, startMs: 0, endMs: 1000, gains: [] };
	const rate = 44100;
	const whole = await renderer.renderClips([clip], 0, 44100, rate);
	const chunks = [];
	for (let frame = 0; frame < 44100; frame += 137) chunks.push(...(await renderer.renderClips([clip], frame, Math.min(137, 44100 - frame), rate))[0]);
	for (let frame = 0; frame < 44100; frame++) {
		const expected = (50.25 + ((frame / rate * 1000 + 0.25) % 1)) / 1000;
		assert.ok(Math.abs(whole[0][frame] - expected) < 1e-7, `phase at frame ${frame}`);
		assert.ok(Math.abs(whole[0][frame] - chunks[frame]) < 1e-7, `chunk at frame ${frame}`);
	}
});

// 【非表示の音声レイヤーは素材を読み出さず、再表示すると元の時刻で音声を出力する】
// 音量0として評価すると不要なデコードやエラーが残るため、期間内でも完全にスキップする。
// 本番と同じSceneの音声計画を使い、計画作成側で除外した素材へアクセスしないことを確認する。
test('skips disabled audio layers before reading media in preview and export', async () => {
	for (const isExport of [false, true]) {
		const calls = [];
		const renderer = new TimelineAudioRenderer(async (...args) => { calls.push(args.slice(0, 4)); return constant(...args); });
		const hidden = layer({ isDisabled: true });
		const silence = await renderSceneAudio(renderer, [hidden], 150, 10, 1000, isExport);
		assert.deepEqual(calls, []);
		assert.deepEqual(silence, [new Float32Array(10), new Float32Array(10)]);
		hidden.isDisabled = false;
		const audible = await renderSceneAudio(renderer, [hidden], 150, 10, 1000, isExport);
		assert.deepEqual(calls, [['asset', 0.07, 10, 1000]]);
		assert.deepEqual(audible[0], new Float32Array(10).fill(1));
	}
});

// 【素材の配置基準を固定した左トリムは、再生開始と読み出し位置を同じ量だけ進める】
// 表示開始とオフセットを同量進めても、トリム前の区間を再生せず右端を維持する。
test('trims audio relative to a fixed source origin', async () => {
	const calls = [];
	const renderer = new TimelineAudioRenderer(async (...args) => { calls.push(args.slice(0, 4)); return constant(...args); });
	const output = await renderSceneAudio(renderer, [layer({ name: 'Layer', clips: [{ id: 'clip', startMs: 140, sourceInMs: 40, sourceOutMs: 100, playbackRate: 1, loop: false, durationMs: 60, assetId: 'asset' }] })], 100, 110, 1000);
	assert.deepEqual(calls, [['asset', 0.04, 60, 1000]]);
	assert.deepEqual([...output[0].slice(0, 40)], Array(40).fill(0));
	assert.deepEqual([...output[0].slice(40, 100)], Array(60).fill(1));
	assert.deepEqual([...output[0].slice(100)], Array(10).fill(0));
});

// 【レイヤーの期間と素材オフセットを独立して扱う】
// 途中シークやトリミングで素材の先頭を再生せず、半開区間の外は無音にする。
test('mixes overlapping layers with source offsets and exclusive ends', async () => {
	const calls = [];
	const renderer = new TimelineAudioRenderer(async (...args) => { calls.push(args.slice(0, 4)); return constant(...args); });
	const output = await renderSceneAudio(renderer, [layer(), layer({ id: 'second' })], 90, 120, 1000);
	assert.deepEqual(calls[0], ['asset', 0.02, 100, 1000]);
	assert.deepEqual([...output[0].slice(0, 10)], Array(10).fill(0));
	assert.deepEqual([...output[0].slice(10, 110)], Array(100).fill(2));
	assert.deepEqual([...output[1].slice(10, 110)], Array(100).fill(1));
	assert.deepEqual([...output[0].slice(110)], Array(10).fill(0));
	await renderSceneAudio(renderer, [layer()], 150, 10, 1000);
	assert.equal(calls[2][1], 0.07);
});

// 【音量の式はFPSやチャンク分割に依存しない】
// プレビューの先読み量と将来の書き出しの処理単位が異なっても同じ音量になる。
test('evaluates scene-time expressions consistently across chunk boundaries', async () => {
	const renderer = new TimelineAudioRenderer(constant);
	const layers = [layer({ audioParamValues: { volume: { inputSource: 'expression', expression: 'TIME_MS / 200' } } })];
	const whole = await renderSceneAudio(renderer, layers, 100, 100, 1000);
	const first = await renderSceneAudio(renderer, layers, 100, 37, 1000);
	const second = await renderSceneAudio(renderer, layers, 137, 63, 1000);
	assert.deepEqual([...whole[0]], [...first[0], ...second[0]]);
	assert.equal(whole[0][50], Math.fround(150 / 200));
});

// 【音声の両端をトリムしても同じScene時刻の音量は変えない】
// 音量はレイヤー所有なので、クリップの長さとオフセットは音量の時計に影響しない。
test('keeps expression timing unchanged when either audio edge is trimmed', async () => {
	const renderer = new TimelineAudioRenderer(constant);
	const original = layer({ name: 'Layer', clips: [{ id: 'clip', startMs: 0, sourceInMs: 0, sourceOutMs: 200, playbackRate: 1, loop: false, durationMs: 200, assetId: 'asset' }],
		audioParamValues: { volume: { inputSource: 'expression', expression: 'TIME_MS / 1000' } } });
	const trimmed = { ...original, clips: [{ ...original.clips[0], startMs: 40, sourceInMs: 40, sourceOutMs: 120, durationMs: 80 }] };
	const whole = await renderSceneAudio(renderer, [original], 0, 200, 1000);
	const part = await renderSceneAudio(renderer, [trimmed], 40, 80, 1000);
	assert.deepEqual(part[0], whole[0].slice(40, 120));
	assert.equal(part[0][0], Math.fround(0.04));
});

// 【音量のキーを所属Scene上の絶対時刻で評価する】
// 左端をトリムしても、フェードの位置をクリップの開始へ移動させない。
test('evaluates audio keyframes at absolute scene times', async () => {
	const renderer = new TimelineAudioRenderer(constant);
	const binding = { inputSource: 'keyframesTimelineInline', offsetMode: 'start', wrapMode: 'clamp', trimmedDurationMs: null,
		keyframesTimeline: { dataType: { kind: 'scalar' }, isNormalized: false, keyframes: [
			{ id: 'start', x: 100, value: 0, interpolation: { type: 'linear' } },
			{ id: 'end', x: 200, value: 1, interpolation: { type: 'linear' } },
		] } };
	const pcm = await renderSceneAudio(renderer, [layer({ name: 'Layer', clips: [{ id: 'clip', startMs: 100, sourceInMs: 100, sourceOutMs: 160, playbackRate: 1, loop: false, durationMs: 60, assetId: 'asset' }], audioParamValues: { volume: binding } })], 150, 1, 1000);
	assert.equal(pcm[0][0], 0.5);
});

// 【holdの境界を音声制御周期でぼかさない】
// キーフレームを5ms制御周期に丸めると、フェードやミュートの指定位置が変わってしまう。
test('preserves sub-control-period hold boundaries and linear keyframes', async () => {
	const renderer = new TimelineAudioRenderer(constant);
	const binding = { inputSource: 'keyframesTimelineInline', offsetMode: 'start', wrapMode: 'clamp', trimmedDurationMs: null,
		keyframesTimeline: { dataType: { kind: 'scalar' }, isNormalized: false, keyframes: [
			{ id: 'a', x: 100, value: 0, interpolation: { type: 'hold' } },
			{ id: 'b', x: 102, value: 1, interpolation: { type: 'linear' } },
			{ id: 'c', x: 104, value: 0, interpolation: { type: 'linear' } },
		] } };
	const output = await renderSceneAudio(renderer, [layer({ audioParamValues: { volume: binding } })], 100, 6, 1000);
	assert.deepEqual([...output[0]], [0, 0, 1, 0.5, 0, 0]);
});

// 【負数・非有限数の音量は無音にし、増幅値はレイヤー単位ではクリップしない】
// NaNを音声出力に流さず、重ね合わせ前に音量情報を失わない。
// 数値へ変換できない文字列は設定ミスとして拒否するため、別のテストで確認する。
test('sanitizes negative and nonfinite gains and permits amplification', async () => {
	const renderer = new TimelineAudioRenderer(constant);
	for (const value of [-1, NaN, Infinity, -Infinity]) {
		const output = await renderSceneAudio(renderer, [layer({ audioParamValues: { volume: { inputSource: 'literal', value } } })], 100, 2, 1000);
		assert.deepEqual([...output[0]], [0, 0]);
	}
	assert.equal((await renderSceneAudio(renderer, [layer({ audioParamValues: { volume: { inputSource: 'literal', value: 3 } } })], 100, 1, 1000))[0][0], 3);
});

// 【音量の数値文字列も共通の数値パラメータと同じ規則で変換する】
// 文字列を一律に無音にせず、変換後の負数は0へ制限し、増幅値は保持する。
test('converts numeric gain strings before applying gain limits', async () => {
	const renderer = new TimelineAudioRenderer(constant);
	for (const [value, expected] of [['0.5', 0.5], [' 3 ', 3], ['1e-1', 0.1], ['-1', 0]]) {
		const output = await renderSceneAudio(renderer, [layer({ audioParamValues: { volume: { inputSource: 'literal', value } } })], 100, 2, 1000);
		assert.deepEqual(output, [new Float32Array(2).fill(expected), new Float32Array(2).fill(expected * 0.5)]);
	}
});

// 【数値に変換できない音量文字列は設定エラーとして伝える】
// 無音へ置き換えると設定ミスに気づけず、一部だけ数値として読むと意図しない音量になる。
// 空白や非有限数を表す文字列も、共通のパラメータ評価の規則に従って拒否する。
test('rejects invalid numeric gain strings instead of silently muting them', async () => {
	const renderer = new TimelineAudioRenderer(constant);
	for (const value of ['bad', '', ' ', '1foo', 'NaN', 'Infinity']) {
		await assert.rejects(
			renderSceneAudio(renderer, [layer({ audioParamValues: { volume: { inputSource: 'literal', value } } })], 100, 2, 1000),
			{ message: `Invalid numeric string ${JSON.stringify(value)} for parameter "Volume". Expected a finite number.` },
		);
	}
});

// 【Sceneの各階層の音量と子の素材時刻を同時に適用する】
// 展開した配置の開始を素材の先頭と誤認したり、親の音量を加算したりしない。
// チャンク分割を変えても同じサンプル列を生成し、末端のTIME変数は所属Sceneの時刻を指す。
test('mixes scene gains using local clocks independently of chunk boundaries', async () => {
	const calls = [];
	const renderer = new TimelineAudioRenderer(async (...args) => { calls.push(args.slice(0, 4)); return constant(...args); });
	const clip = { sourceId: 'asset', sourceTiming: { startMs: 1150, sourceInMs: 0, sourceOutMs: 1280 - (1150), playbackRate: 1, loop: false }, startMs: 1180, endMs: 1280, gains: [
			{ sceneStartMs: 0, volume: { inputSource: 'literal', value: 2 }, automationGraphs: [] },
			{ sceneStartMs: 1000, volume: { inputSource: 'literal', value: 0.25 }, automationGraphs: [] },
			{ sceneStartMs: 1050, volume: { inputSource: 'expression', expression: 'TIME_MS / 100' }, automationGraphs: [] },
		] };
	const whole = await renderer.renderClips([clip], 1170, 120, 1000);
	const first = await renderer.renderClips([clip], 1170, 47, 1000);
	const second = await renderer.renderClips([clip], 1217, 73, 1000);
	assert.deepEqual(calls[0], ['asset', 0.03, 100, 1000]);
	assert.deepEqual([...whole[0]], [...first[0], ...second[0]]);
	assert.deepEqual([...whole[0].slice(0, 10)], Array(10).fill(0));
	assert.equal(whole[0][10], Math.fround(0.65));
	assert.deepEqual([...whole[0].slice(110)], Array(10).fill(0));
});

// 【Scene音量と音声素材の式はそれぞれのスコープだけを使う】
// 各階層は所属SceneのTIMEを持ち、クリップ専用のPROGRESSやEND_TIMEを公開せず、
// nameForReferenceが同じグラフは所有者ごとに解決する。書き出しかどうかは両スコープへ明示的に渡す。
test('isolates scene gain variables and graphs from the audio layer scope', async () => {
	const expression = expression => ({ inputSource: 'expression', expression });
	const graph = value => ({ id: 'shared', nameForReference: 'shared', isNormalized: true,
		points: [{ id: 'point', x: 0, y: value, bezierControlPointA: [0, 0], bezierControlPointB: [0, 0] }] });
	const renderer = new TimelineAudioRenderer(constant);
	const clip = { sourceId: 'asset', sourceTiming: { startMs: 1000, sourceInMs: 0, sourceOutMs: 1600 - (1000), playbackRate: 1, loop: false }, startMs: 1400, endMs: 1600, gains: [{ sceneStartMs: 900,
			volume: expression('if IS_EXPORT { TEST_SAME_NAME + GRAPH("shared", 0, "clamp") } else { 0 }'), automationGraphs: [graph(0.5)] }, { sceneStartMs: 1000,
			volume: expression('if IS_EXPORT { TIME + GRAPH("shared", 0, "clamp") } else { 0 }'), automationGraphs: [graph(0.25)] }] };
	assert.equal((await renderer.renderClips([clip], 1500, 1, 1000, true))[0][0], 1.875);
	assert.equal((await renderer.renderClips([clip], 1500, 1, 1000, false))[0][0], 0);
	for (const variable of ['END_TIME', 'END_TIME_MS', 'PROGRESS']) {
		clip.gains[0].volume = expression(variable);
		await assert.rejects(renderer.renderClips([clip], 1500, 1, 1000, true), /Base expression/);
	}
});
