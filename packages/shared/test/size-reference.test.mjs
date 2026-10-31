import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SIZE_REFERENCES, getSizeReferenceLength, isSizeReference } from '../src/size-reference.ts';
import { areDataTypesEqual, isTextureDataType } from '../src/data-type/data-type.ts';
import { genEmptyValue } from '../src/parameter/parameter-default.ts';
import { prepareExpressionParameterValue } from '../src/parameter/expression-parameter-value.ts';
import { validateParameterDefaultValues } from '../src/parameter/static-parameter.ts';
import { isKeyframesDataType, isKeyframeValue, supportsKeyframeInterpolation } from '../src/keyframes/keyframes-timeline.ts';
import { evaluateKeyframesTimeline } from '../src/keyframes/keyframes-timeline-evaluator.ts';

// 【固定軸と短辺・長辺の違いを、縦長・横長・正方形で保つ】
// 幅と高さを入れ替えても固定軸はその軸へ追従し、短辺・長辺は形状を歪めず同じ物理寸法を返す。
// 出力倍率を変えても画面に対する相対的なサイズを保つことを、全4基準で確認する。
test('resolves all four size references across aspect ratios and render scales', () => {
	for (const [width, height, expected] of [[1920, 1080, [1080, 1920, 1080, 1920]], [1080, 1920, [1920, 1080, 1080, 1920]], [1000, 1000, [1000, 1000, 1000, 1000]]]) {
		SIZE_REFERENCES.forEach((reference, index) => {
			assert.equal(getSizeReferenceLength(reference, { width, height }), expected[index]);
			assert.equal(getSizeReferenceLength(reference, { width: width * 2, height: height * 2 }), expected[index] * 2);
		});
	}
});

// 【サイズ基準を専用の型として扱い、既定値を長辺にする】
// 汎用enumやGPUへの入力型とは区別する。式・加工式では同じ4値だけを受け入れ、
// Checkerなどで廃止したStretchを既定値や不正な入力として暗黙に読み替えない。
test('uses a dedicated non-texture type with a long-side default and validated values', () => {
	const definition = { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', control: {} }, defaultValue: { inputSource: 'literal', value: 'longSide' } };
	assert.equal(genEmptyValue(definition), 'longSide');
	assert.doesNotThrow(() => validateParameterDefaultValues(definition));
	assert.equal(isTextureDataType(definition.dataType), false);
	assert.equal(areDataTypesEqual(definition.dataType, { kind: 'sizeReference' }), true);
	assert.equal(areDataTypesEqual(definition.dataType, { kind: 'enum', options: [...SIZE_REFERENCES] }), false);
	for (const reference of SIZE_REFERENCES) {
		assert.equal(isSizeReference(reference), true);
		assert.equal(prepareExpressionParameterValue(definition, reference), reference);
	}
	for (const value of ['stretch', 'cover', 'contain', '', 0, null]) {
		assert.equal(isSizeReference(value), false);
		assert.throws(() => prepareExpressionParameterValue(definition, value), /Invalid sizeReference/);
		assert.throws(() => getSizeReferenceLength(value, { width: 1920, height: 1080 }), /Invalid Size Reference/);
	}
});

// 【サイズ基準のキーフレームは離散値として切り替える】
// 指定した時刻で基準が変わることを保証し、数値補間や未知の基準で描画結果を曖昧にしない。
test('holds size-reference keyframes until the next key', () => {
	const dataType = { kind: 'sizeReference' };
	assert.equal(isKeyframesDataType(dataType), true);
	assert.equal(supportsKeyframeInterpolation(dataType), false);
	assert.equal(isKeyframeValue(dataType, 'height'), true);
	assert.equal(isKeyframeValue(dataType, 'stretch'), false);
	const timeline = { dataType, isNormalized: false, keyframes: [
		{ id: 'first', x: 0, value: 'height', interpolation: { type: 'hold' } },
		{ id: 'next', x: 1000, value: 'longSide', interpolation: { type: 'hold' } },
	] };
	const playback = { offsetMode: 'start', wrapMode: 'clamp', trimmedDurationMs: null };
	assert.equal(evaluateKeyframesTimeline(timeline, playback, 999, 2000, 'width'), 'height');
	assert.equal(evaluateKeyframesTimeline(timeline, playback, 1000, 2000, 'width'), 'longSide');
});
