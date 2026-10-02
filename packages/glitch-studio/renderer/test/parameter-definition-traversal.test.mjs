import assert from 'node:assert/strict';
import { test } from 'node:test';
import { areDataTypesEqual } from '../../shared/src/data-type.ts';
import { getArrayElementDefinition, getStructFieldDefinitions, isParameterType } from '../../shared/src/parameter.ts';
import { genEmptyValue } from '../../shared/src/utility/misc.ts';
import definition from '../../shared/src/effect/fx/testStructArray/_def_.ts';

// 参照が異なる型でも同じ構造ならプレビュー値を維持し、要素型が変われば再初期化する。
test('compares data type structures independently of object identity and field order', () => {
	const dataType = definition.paramDefs.buzzs.dataType;
	assert.equal(areDataTypesEqual(dataType, structuredClone(dataType)), true);
	assert.equal(areDataTypesEqual({ kind: 'enum', options: ['a', 'b'] }, { kind: 'enum', options: ['b', 'a'] }), true);
	assert.equal(areDataTypesEqual({ kind: 'enum', options: ['a'] }, { kind: 'enum', options: ['b'] }), false);
	assert.equal(areDataTypesEqual(dataType, { kind: 'array', elementType: { kind: 'scalar' } }), false);
	assert.equal(areDataTypesEqual({ kind: 'struct', fields: { a: { kind: 'scalar' }, b: { kind: 'color' } } }, { kind: 'struct', fields: { b: { kind: 'color' }, a: { kind: 'scalar' } } }), true);
	assert.equal(areDataTypesEqual({ kind: 'struct', fields: { a: { kind: 'scalar' } } }, { kind: 'struct', fields: { b: { kind: 'scalar' } } }), false);
});

// 子の型・UI・初期値・接続可否を同じパスで取り出し、元の保存定義は変更しない。
test('resolves nested parameter definitions from separate type UI and settings trees', () => {
	const source = definition.paramDefs.buzzs;
	const before = structuredClone(source);
	const element = getArrayElementDefinition(source);
	assert.equal(isParameterType(element, 'struct'), true);
	const fields = getStructFieldDefinitions(element);
	assert.deepEqual(fields.image.dataType, { kind: 'color' });
	assert.equal(fields.image.canNode, true);
	assert.equal(fields.image.ui.label, 'Image');
	assert.deepEqual(fields.image.ui.control, {});
	assert.deepEqual(fields.x.ui.control, { controlType: 'range', min: -1, max: 1, step: 0.01 });
	assert.deepEqual(fields.image.defaultValue.value, [0, 0, 1, 1]);
	assert.deepEqual(source, before);
});

// enumの空値は選択肢の文字列、structの空値は子のBindingであり、評価済みの素の値とは異なる。
test('creates string enum fallbacks and independent struct default bindings', () => {
	assert.equal(genEmptyValue({ dataType: { kind: 'enum', options: ['first', 'second'] } }), 'first');
	assert.equal(genEmptyValue({ dataType: { kind: 'enum', options: [] } }), '');
	const element = getArrayElementDefinition(definition.paramDefs.buzzs);
	const value = genEmptyValue(element);
	assert.deepEqual(value, element.defaultValue.value);
	value.image.value[0] = 0.9;
	assert.equal(element.fields.image.defaultValue.value[0], 0);
});
