import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTimelineClipTiming, validateTimelineClips, isTimelineClipActive, getTimelineClipContentTime, getTimelineClipMoveBounds, getTimelineClipTrimBounds, getTimelineClipInsertionDuration, getTimelineMediaMaxDurationMs } from '../src/timeline/timing.ts';
import { validateTimelineParameterBinding } from '../src/timeline/parameter-binding.ts';

const clip = (id, startMs, durationMs, contentOffsetMs = 0) => ({ id, startMs, durationMs, contentOffsetMs });

// 【半開区間の接触は許可し、素材の未使用区間を衝突に含めない】
// 素材の開始位置が重なっていても、実際に表示するクリップが接しているだけなら配置できる。
// 空レイヤーと小数の内容オフセットは有効だが、配置は整数msに限定し、0長や非有限値は保存できない。
test('validates displayed intervals and local IDs independently of source offsets', () => {
	const clips = [clip('a', 0, 100, 500), clip('b', 100, 1, 600.5)];
	validateTimelineClips(clips);
	validateTimelineClips([]);
	assert.equal(isTimelineClipActive(clips[0], 100), false);
	assert.equal(isTimelineClipActive(clips[1], 100), true);
	assert.equal(getTimelineClipContentTime(clips[1], 100.25), 600.75);
	assert.throws(() => validateTimelineClips([clips[0], clip('b', 99, 1)]), /Overlapping/);
	assert.throws(() => validateTimelineClips([clips[0], clip('a', 100, 1)]), /Duplicate/);
	for (const invalid of [clip('a', -1, 1), clip('a', 0, 0), clip('a', 0, 1, -1), clip('a', 0, Infinity), clip('a', NaN, 1),
		clip('a', 0.5, 1), clip('a', 0, 0.5), clip('a', 0, 1000.1), clip('a', Number.MAX_SAFE_INTEGER, 1), clip('a', 0, 1, Infinity)]) {
		assert.throws(() => validateTimelineClips([invalid]), /Invalid clip timing/);
	}
});

// 【配置は整数化しても、素材位置と再生時刻の小数精度を保つ】
// 開始時刻が大きくても、クリップ先頭で読み出す素材フレームが変わらないよう、
// 内容時刻の計算で小数オフセットを大きなScene時刻に加算しない。
test('quantizes placement without quantizing content or evaluation time', () => {
	assert.deepEqual(createTimelineClipTiming(123.6, 2000.75), { startMs: 124, durationMs: 2000, contentOffsetMs: 0 });
	const timing = clip('fractional', 1000000, 100, 1000 / 30);
	assert.equal(getTimelineClipContentTime(timing, 1000000), 1000 / 30);
	assert.equal(getTimelineClipContentTime(timing, 1000000.25), 1000 / 30 + 0.25);
	assert.equal(isTimelineClipActive(timing, 1000099.75), true);
	assert.equal(isTimelineClipActive(timing, 1000100), false);
});

// 【非選択の隣接クリップを追い越さず、選択中のクリップ同士は同量移動できる】
// 最終地点だけの重なり検査では隣を飛び越えてしまう。選択が不連続な場合も隣接区間で止める。
test('bounds group moves against unselected neighbors without allowing tunneling', () => {
	const clips = [clip('a', 100, 100), clip('b', 250, 100), clip('c', 500, 100)];
	const selected = new Set(['a', 'b']);
	assert.deepEqual(getTimelineClipMoveBounds(clips, selected, 'a'), { minDelta: -100, maxDelta: 300 });
	assert.deepEqual(getTimelineClipMoveBounds(clips, selected, 'b'), { minDelta: -250, maxDelta: 150 });
	assert.deepEqual(getTimelineClipMoveBounds(clips, new Set(['a', 'c']), 'a'), { minDelta: -100, maxDelta: 50 });
	assert.deepEqual(getTimelineClipMoveBounds(clips, new Set(['a', 'c']), 'c'), { minDelta: -150, maxDelta: Infinity });
});

// 【追加とトリムは隣接区間・素材範囲・内容時刻0で制限する】
// 動画の未使用素材があっても隣を削らず、生成系は以前の左トリムを独立した延長操作で戻せない。
test('limits insertion and trimming while prohibiting generated left extension', () => {
	const clips = [clip('a', 100, 200, 50), clip('b', 400, 100)];
	assert.equal(getTimelineClipInsertionDuration(clips, 300), 100);
	assert.equal(getTimelineClipInsertionDuration(clips, 100), 0);
	assert.equal(getTimelineClipInsertionDuration(clips, 500), 5000);
	assert.deepEqual(getTimelineClipTrimBounds(clips, 'a', 'start', true, 500), { minDelta: -50, maxDelta: 199 });
	assert.deepEqual(getTimelineClipTrimBounds(clips, 'a', 'start', false), { minDelta: 0, maxDelta: 199 });
	assert.deepEqual(getTimelineClipTrimBounds(clips, 'a', 'end', true, 500), { minDelta: -199, maxDelta: 100 });
	assert.deepEqual(getTimelineClipTrimBounds(clips, 'a', 'end', true, 260), { minDelta: -199, maxDelta: 10 });
});

// 【小数の素材位置を保ったまま、長さとトリム量を整数msの範囲内に制限する】
// 素材長を四捨五入して超過させたり、左端を内容時刻0へ寄せるために配置を小数化したりしない。
// 素材を短く差し替えた場合は、右端を縮めるための負の上限も返す。
test('bounds integer edits by fractional media times and shorter replacements', () => {
	const clips = [clip('a', 100, 200, 50.25), clip('b', 400, 100)];
	assert.equal(getTimelineClipInsertionDuration([], 0, 1234.75), 1234);
	assert.equal(getTimelineClipInsertionDuration([], 0, 0.75), 0);
	assert.equal(getTimelineClipInsertionDuration([], 0.5), 0);
	assert.deepEqual(getTimelineClipTrimBounds(clips, 'a', 'start', true, 300.6), { minDelta: -50, maxDelta: 199 });
	assert.deepEqual(getTimelineClipTrimBounds(clips, 'a', 'end', true, 300.6), { minDelta: -199, maxDelta: 50 });
	assert.deepEqual(getTimelineClipTrimBounds(clips, 'a', 'end', true, 150.6), { minDelta: -199, maxDelta: -100 });
});

// 【素材終端の減算誤差でクリップを余分に1ms短くしない】
// 小数オフセットを保持すると、4.1 - 1.1のような減算でも整数の直前になり得る。
// その演算誤差は吸収するが、実際に不足している小数部分まで切り上げない。
test('tolerates media subtraction roundoff without rounding up real fractional limits', () => {
	assert.equal(getTimelineMediaMaxDurationMs(1.1, 4.1), 3);
	assert.equal(getTimelineMediaMaxDurationMs(1.1, 4.0999), 2);
	assert.equal(getTimelineMediaMaxDurationMs(1.1, 4.9), 3);
	assert.equal(getTimelineMediaMaxDurationMs(1.1, Infinity), Infinity);
});

// 【タイムラインのキーはSceneの絶対時刻だけを受け入れる】
// 保存やコマンド経由でも、UIで扱えない終端基準・正規化・繰り返しのキーを混入させない。
test('rejects unsupported timeline keyframe timing modes', () => {
	const binding = { inputSource: 'keyframesTimelineInline', offsetMode: 'start', wrapMode: 'clamp', trimmedDurationMs: null,
		keyframesTimeline: { dataType: { kind: 'scalar' }, isNormalized: false, keyframes: [] } };
	validateTimelineParameterBinding(binding);
	for (const patch of [{ offsetMode: 'end' }, { wrapMode: 'repeat' }, { trimmedDurationMs: 1000 }, { keyframesTimeline: { ...binding.keyframesTimeline, isNormalized: true } }]) {
		assert.throws(() => validateTimelineParameterBinding({ ...binding, ...patch }), /absolute scene time/);
	}
});

// 【タイムラインのキーにも整数msの保存規約を適用する】
// モジュール内部のキーにはこの検証を使わず、Scene上で編集するキーの精度だけを制限する。
test('rejects fractional and unsafe saved timeline keyframe positions', () => {
	const binding = x => ({ inputSource: 'keyframesTimelineInline', offsetMode: 'start', wrapMode: 'clamp', trimmedDurationMs: null,
		keyframesTimeline: { dataType: { kind: 'scalar' }, isNormalized: false, keyframes: [{ id: 'key', x, value: 1, interpolation: { type: 'linear' } }] } });
	validateTimelineParameterBinding(binding(1000));
	for (const x of [0.5, -1, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
		assert.throws(() => validateTimelineParameterBinding(binding(x)), /integer milliseconds/);
	}
});
