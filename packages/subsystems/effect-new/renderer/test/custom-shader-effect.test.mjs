import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCustomShaderEffectInstance } from '../src/custom-shader-effect/create-custom-shader-effect-instance.ts';

// 【Custom Shader Effectは初期化時に全入力のuniform／texture区分を必要とする】
// 初回の描画値から区分を推測すると、親のCustom Node Graph Effectが配線とpipelineを先に確定できない。
// 未指定とCPU専用入力を、シェーダーのコンパイルや出力テクスチャの確保を始める前に検出する。
test('requires a uniform or texture layout for every Custom Shader Effect parameter at initialization', async () => {
	const customShaderEffect = {
		paramDefs: { stableInputId: { nameForReference: 'source', dataType: { kind: 'color' } } },
		outputDefs: { outputId: { nameForReference: 'color', dataType: { kind: 'color' } } },
	};
	const options = { resolution: { width: 2, height: 1 }, requestedOutputIds: ['outputId'] };
	for (const inputLayouts of [{}, { stableInputId: { kind: 'value' } }]) {
		await assert.rejects(createCustomShaderEffectInstance(customShaderEffect, { ...options, inputLayouts }, {}),
			/stableInputId.*uniform or texture/);
	}
});
