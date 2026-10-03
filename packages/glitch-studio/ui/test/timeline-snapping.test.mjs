import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundled = await build({
	absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
	stdin: {
		contents: "export * from './src/utility/timeline-snapping.ts'; export * from './src/utility/timeline-ticks.ts'; export { constrainTimelineMove, getTimelineSnappingTimes } from './src/utility/timeline-selection.ts';",
		resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts',
	},
	bundle: true, platform: 'node', format: 'cjs', write: false,
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { getTimelineTickCount, getTimelineTicks, getTimelineMinorTicks, getTimelineClipTicks, getTimelineLocalTicks, formatTimelineTimecode,
	getTimelineClipSnapPoints, getTimelineSnapCandidates, getTimelineSeekPosition, constrainTimelineMove, getTimelineSnappingTimes } = module.exports;

const modes = ['legacy', 'binary', 'decimal125'];
const snapSettings = { enabled: true, globalTicks: true, localTicks: true, seekBar: true };
const clip = { startMs: 100, durationMs: 400, contentOffsetMs: 0.25 };
const bounds = { minDelta: -100, maxDelta: 1000 };

// 【現在の方式・二分割・1・2・5系列を区別して選ぶ】
// 同じ表示範囲でも選んだ方式に従って間隔が変わることを、具体的な目盛り位置で確認する。
// 全方式が従来の生成関数へ戻ってしまう退行を防ぐ。
test('selects distinct tick positions for each spacing mode', () => {
	assert.deepEqual(getTimelineTicks(0, 1200, 5, 'legacy'), [0, 300, 600, 900, 1200]);
	assert.deepEqual(getTimelineTicks(0, 1200, 5, 'binary'), [0, 250, 500, 750, 1000, 1250]);
	assert.deepEqual(getTimelineTicks(0, 1200, 5, 'decimal125'), [0, 200, 400, 600, 800, 1000, 1200]);
});

// 【二分割は1秒を基準に細分化し、既存の目盛りを残す】
// ミリ秒の2の累乗を使うと1秒の位置を基準にできない。小数msになっても目盛りを丸めず、
// ズームイン前に見えていた時刻が次の段階にも残ることを確認する。
test('halves second-based intervals without rounding fractional milliseconds', () => {
	for (const step of [2000, 1000, 500, 250, 125, 62.5, 31.25]) {
		const coarse = getTimelineTicks(0, step * 4, 5, 'binary');
		assert.deepEqual(coarse, [0, step, step * 2, step * 3, step * 4]);
		const fine = getTimelineTicks(0, step * 4, 9, 'binary');
		assert.equal(fine[1], step / 2);
		for (const tick of coarse) assert.ok(fine.includes(tick));
	}
});

// 【1・2・5系列では十進数の桁をまたいでも間隔を維持する】
// 秒以下だけでなく秒以上のズームでも同じ系列を使い、300msなどの間隔を混ぜない。
test('uses the decimal 1-2-5 sequence across zoom levels', () => {
	for (const step of [5000, 2000, 1000, 500, 200, 100, 50]) {
		assert.deepEqual(getTimelineTicks(0, step * 4, 5, 'decimal125'), [0, step, step * 2, step * 3, step * 4]);
	}
});

// 【表示幅に応じて全体・ローカルの目盛り密度を同時に調整する】
// 狭いパネルで密集させず、広いパネルでは同じ時間範囲を細かく編集できる必要がある。
// 原点をずらしても同じ表示倍率なら間隔が一致し、未表示の幅0でも計算を継続できる。
test('adapts global and local tick density to viewport width', () => {
	assert.equal(getTimelineTickCount(0), 3);
	for (const mode of modes) {
		const narrow = getTimelineTicks(0, 12000, getTimelineTickCount(480), mode);
		const wide = getTimelineTicks(0, 12000, getTimelineTickCount(1440), mode);
		assert.ok(wide.length > narrow.length);
		for (const width of [0, 120, 480, 1440]) {
			const count = getTimelineTickCount(width);
			const global = getTimelineTicks(-1200, 12000, count, mode);
			const local = getTimelineLocalTicks(1234, 34, 12000, count, mode);
			assert.deepEqual(local, global);
		}
	}
});

// 【主目盛り間の1/2と1/3・2/3を独立して切り替える】
// 両方を有効にした際に六分割した全点を追加したり、一方を切ったとき他方の位置を動かしたりしない。
// 入力の主目盛りを書き換えず、空・単一の主目盛りから補助目盛りを作らない。
test('independently enables halves and thirds between adjacent major ticks', () => {
	const major = Object.freeze([0, 600, 1200]);
	for (const [halves, thirds, expected] of [
		[false, false, []], [true, false, [300, 900]],
		[false, true, [200, 400, 800, 1000]], [true, true, [200, 300, 400, 800, 900, 1000]],
	]) {
		assert.deepEqual(getTimelineMinorTicks(major, { halves, thirds }), expected);
		assert.deepEqual(getTimelineMinorTicks([], { halves, thirds }), []);
		assert.deepEqual(getTimelineMinorTicks([600], { halves, thirds }), []);
	}
});

// 【補助目盛りをオフにすると表示位置もクリップ・キー・シークの吸着先も消える】
// 三方式それぞれで全設定の組み合わせを試し、表示用の補助目盛りから実際の吸着処理までを通す。
// 1/3・2/3の小数msは保存時だけ丸め、スナップのガイド線も保存位置に揃える。
test('uses only enabled displayed subdivisions for moving and seeking in every mode', () => {
	for (const mode of modes) for (const halves of [false, true]) for (const thirds of [false, true]) {
		const major = getTimelineTicks(0, 4000, 5, mode);
		const minor = getTimelineMinorTicks(major, { halves, thirds });
		const candidates = getTimelineSnapCandidates(snapSettings, [], [...major, ...minor]);
		for (const [target, enabled] of [[500, halves], [1000 / 3, thirds], [2000 / 3, thirds]]) {
			const rounded = Math.round(target);
			const rawPosition = rounded - 2;
			const points = [{ time: 0, minDelta: 0, maxDelta: 4000 }];
			const result = constrainTimelineMove(rawPosition, points, candidates, 1);
			assert.deepEqual(result, { delta: enabled ? rounded : rawPosition, snappingTime: enabled ? rounded : null });
			assert.deepEqual(getTimelineSnappingTimes(points, candidates, result.delta), enabled ? [rounded] : []);
			assert.deepEqual(getTimelineSeekPosition(rawPosition, 4000, candidates, 1), {
				timeMs: result.delta, snappingTime: result.snappingTime,
			});
		}
		const movingClip = { startMs: 0, durationMs: 100, contentOffsetMs: 0 };
		const points = getTimelineClipSnapPoints(movingClip, { minDelta: 0, maxDelta: 3900 }, { start: true, end: false });
		assert.equal(constrainTimelineMove(498, points, candidates, 1).delta, halves ? 500 : 498);
	}
});

// 【ローカル目盛りでも1/2・1/3を独立して表示・吸着へ反映する】
// 全体の目盛りだけ設定に追従し、各クリップ内の補助目盛りが固定のまま残る退行を防ぐ。
// Scene原点と異なる位置のクリップを使い、ローカルスナップのオフでも候補が残らないことを確認する。
test('applies subdivision switches to local display and scoped snapping', () => {
	const timing = { startMs: 100, durationMs: 1000, contentOffsetMs: 0 };
	for (const mode of modes) for (const halves of [false, true]) for (const thirds of [false, true]) {
		const ticks = getTimelineClipTicks(timing, 0, 4000, 5, mode, { halves, thirds });
		const expectedContentTimes = [...(thirds ? [1000 / 3] : []), ...(halves ? [500] : []), ...(thirds ? [2000 / 3] : [])];
		assert.deepEqual(ticks.minor.map(tick => tick.contentTimeMs), expectedContentTimes);
		for (const localTicks of [false, true]) {
			const candidates = getTimelineSnapCandidates({ ...snapSettings, globalTicks: false, localTicks }, [], [], [...ticks.major, ...ticks.minor].map(tick => tick.sceneTimeMs));
			for (const [position, subdivisionEnabled] of [[433, thirds], [600, halves], [767, thirds]]) {
				assert.deepEqual(constrainTimelineMove(position - 2, [{ time: 0, minDelta: 0, maxDelta: 4000 }], candidates, 1), {
					delta: localTicks && subdivisionEnabled ? position : position - 2,
					snappingTime: localTicks && subdivisionEnabled ? position : null,
				});
			}
		}
	}
});

// 【短いクリップ内の三分割目盛りを小数オフセット込みでScene時刻へ変換する】
// 主目盛りがないクリップでも補助目盛りを失わず、内容時刻を先に丸めて位置をずらさない。
// 非表示にした補助目盛りと、クリップの外側の目盛りには吸着させない。
test('keeps fractional local thirds inside short clips and rounds after converting to scene time', () => {
	const shortClip = { startMs: 1250, durationMs: 100, contentOffsetMs: 300.75 };
	for (const mode of modes) {
		const ticks = getTimelineClipTicks(shortClip, 0, 4000, 5, mode, { halves: false, thirds: true });
		assert.deepEqual(ticks.major, []);
		assert.equal(ticks.minor.length, 1);
		assert.equal(ticks.minor[0].contentTimeMs, 1000 / 3);
		const sceneTime = 1250 - 300.75 + 1000 / 3;
		assert.equal(ticks.minor[0].sceneTimeMs, sceneTime);
		const candidates = getTimelineSnapCandidates({ ...snapSettings, globalTicks: false }, [], [1280], ticks.minor.map(tick => tick.sceneTimeMs));
		assert.deepEqual(constrainTimelineMove(1280, [{ time: 0, minDelta: 0, maxDelta: 4000 }], candidates, 1), { delta: 1283, snappingTime: 1283 });
		assert.deepEqual(getTimelineClipTicks(shortClip, 0, 4000, 5, mode, { halves: false, thirds: false }), { major: [], minor: [] });
		assert.deepEqual(getTimelineClipTicks(shortClip, 1300, 4000, 5, mode, { halves: true, thirds: true }), { major: [], minor: [] });
	}
});

// 【クリップの表示区間は終端を含まず、画面端の補助目盛りは保持する】
// 三分割の目盛りがクリップ終端と一致しても描画・吸着対象に入れない。
// 画面で見えている始端の目盛りは、直前の主目盛りが画面外でも残す必要がある。
test('clips subdivisions to half-open clip bounds and inclusive viewport bounds', () => {
	const timing = { startMs: 100, durationMs: 300, contentOffsetMs: 300 };
	const ticks = getTimelineClipTicks(timing, 100, 2400, 5, 'legacy', { halves: true, thirds: true });
	assert.deepEqual(ticks, { major: [], minor: [{ contentTimeMs: 300, sceneTimeMs: 100 }, { contentTimeMs: 400, sceneTimeMs: 200 }] });
});

// 【クリップ自身の先端・後端を独立して吸着元にする】
// 他クリップの端が候補にあっても、無効にした自分の端では吸着もガイド表示もしない。
// 両方が有効なら近い候補を選び、両方が無効なら通常の移動量を保つ。
test('selects snap sources independently for clip starts and ends', () => {
	const targets = [200, 602];
	for (const start of [false, true]) for (const end of [false, true]) {
		const points = getTimelineClipSnapPoints(clip, bounds, { start, end });
		const expected = start ? { delta: 100, snappingTime: 200 } : end ? { delta: 102, snappingTime: 602 } : { delta: 99, snappingTime: null };
		assert.deepEqual(constrainTimelineMove(99, points, targets, 1), expected);
		assert.deepEqual(getTimelineSnappingTimes(points, targets, expected.delta), expected.snappingTime == null ? [] : [expected.snappingTime]);
	}
	const bothEdges = getTimelineClipSnapPoints(clip, bounds, { start: true, end: true });
	assert.deepEqual(constrainTimelineMove(101.5, bothEdges, targets, 1), { delta: 102, snappingTime: 602 });
});

// 【片端を無効にしても相手クリップのその端は吸着先として使える】
// 「何を」と「何に」の設定を取り違え、後端を無効にしただけで相手の後端への吸着まで失う退行を防ぐ。
test('keeps other clip endpoints available regardless of the enabled source edge', () => {
	const otherClip = { startMs: 1000, durationMs: 200 };
	const candidates = getTimelineSnapCandidates({ ...snapSettings, globalTicks: false }, [otherClip.startMs, otherClip.startMs + otherClip.durationMs], []);
	for (const edge of ['start', 'end']) {
		const points = getTimelineClipSnapPoints(clip, { ...bounds, maxDelta: 2000 }, { start: edge === 'start', end: edge === 'end' });
		const source = edge === 'start' ? 100 : 500;
		for (const target of [1000, 1200]) {
			const delta = target - source;
			const result = constrainTimelineMove(delta - 2, points, candidates, 1);
			assert.deepEqual(result, { delta, snappingTime: target });
		}
	}
});

// 【両端の吸着を無効にしても複数クリップの移動制約を残す】
// 吸着しない端を対象ごと消すと、移動自体ができなくなったり別クリップを追い越したりする。
// 最も厳しい制約で共通差分を制限し、偶然候補と一致してもガイドを出さない。
test('preserves shared movement bounds when all clip snap sources are disabled', () => {
	const points = [
		...getTimelineClipSnapPoints(clip, bounds, { start: false, end: false }),
		...getTimelineClipSnapPoints({ ...clip, startMs: 1000 }, { minDelta: -50, maxDelta: 80 }, { start: false, end: false }),
	];
	assert.deepEqual(constrainTimelineMove(200, points, [580, 1480], 1), { delta: 80, snappingTime: null });
	assert.deepEqual(constrainTimelineMove(-200, points, [], 1), { delta: -50, snappingTime: null });
	assert.deepEqual(constrainTimelineMove(20.6, points, [123], 1), { delta: 21, snappingTime: null });
	assert.deepEqual(getTimelineSnappingTimes(points, [580, 1480], 80), []);
});

// 【トリム時は操作している端だけをその端の設定で吸着させる】
// 動かない反対端が候補に近くてもトリム量へ影響させない。
// 素材長や隣接クリップによる制限は、吸着の有効・無効にかかわらず優先する。
test('snaps only the trimmed edge while preserving trim bounds', () => {
	for (const edge of ['start', 'end']) for (const start of [false, true]) for (const end of [false, true]) {
		const points = getTimelineClipSnapPoints(clip, { minDelta: -20, maxDelta: 50 }, { start, end }, edge);
		assert.equal(points.length, 1);
		const source = edge === 'start' ? 100 : 500;
		const enabled = edge === 'start' ? start : end;
		assert.deepEqual(constrainTimelineMove(18, points, [source + 20], 1), { delta: enabled ? 20 : 18, snappingTime: enabled ? source + 20 : null });
		assert.deepEqual(constrainTimelineMove(49, points, [source + 52], 1), { delta: 49, snappingTime: null });
		assert.deepEqual(constrainTimelineMove(100, points, [source + 52], 1), { delta: 50, snappingTime: null });
	}
});

// 【シークバーへの吸着は全体スイッチと専用スイッチに従う】
// グローバル・ローカル目盛りの設定とは独立し、クリップとキーの両方で同じ候補を使う。
// 小数の再生位置でも保存位置・ガイド位置は整数msに揃える。
test('gates seek-bar targets independently of tick settings for clips and keyframes', () => {
	for (const enabled of [false, true]) for (const seekBar of [false, true]) for (const globalTicks of [false, true]) for (const localTicks of [false, true]) {
		const candidates = getTimelineSnapCandidates({ enabled, seekBar, globalTicks, localTicks }, [], [1000], [2000], 333.6);
		const sources = [
			getTimelineClipSnapPoints(clip, bounds, { start: true, end: false }),
			[{ time: 100, ...bounds }],
		];
		for (const points of sources) {
			const result = constrainTimelineMove(232, points, candidates, 1);
			assert.deepEqual(result, { delta: enabled && seekBar ? 234 : 232, snappingTime: enabled && seekBar ? 334 : null });
			assert.deepEqual(getTimelineSnappingTimes(points, candidates, result.delta), enabled && seekBar ? [334] : []);
		}
	}
});

// 【シーク操作ではシークバー自身の位置を吸着先へ含めない】
// 「シークバー位置へ吸着」と「シークバーを目盛りへ吸着」は別の動作。
// 自身の位置を候補へ渡さない呼び出しを維持し、細かいシークが元の位置へ引き戻されないようにする。
test('omits self-snapping while seeking and deduplicates coincident targets', () => {
	const candidates = getTimelineSnapCandidates(snapSettings, [], [500]);
	assert.deepEqual(getTimelineSeekPosition(332, 1000, candidates, 1), { timeMs: 332, snappingTime: null });
	assert.deepEqual(getTimelineSeekPosition(498, 1000, candidates, 1), { timeMs: 500, snappingTime: 500 });
	assert.deepEqual(getTimelineSnapCandidates(snapSettings, [500], [500], [500], 500), [500]);
	assert.deepEqual(getTimelineSnapCandidates({ ...snapSettings, enabled: false }, [500], [500], [500], 500), []);
});

// 【二分割の小数ミリ秒をラベルでも保持する】
// 正確な位置に描いた62.5msの目盛りを62msと表示して、スナップ結果との関係を誤解させない。
// 負の時刻・0・分境界と、演算誤差による不要な末尾の桁も確認する。
test('formats fractional millisecond ticks without truncation or floating-point noise', () => {
	for (const [time, label] of [[62.5, '0:00.0625'], [-31.25, '-0:00.03125'], [60062.5, '1:00.0625'], [0, '0:00'], [-0, '0:00'], [0.1 + 0.2, '0:00.0003']]) {
		assert.equal(formatTimelineTimecode(time), label);
	}
});
