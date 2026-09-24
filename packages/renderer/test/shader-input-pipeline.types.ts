import { createShaderInputPipeline } from '../../shared/src/shader-input-pipeline.ts';
import type { ShaderInput } from '../../shared/src/shader-input.ts';

declare const device: GPUDevice;
declare const vertex: GPUShaderModule;
declare const input: ShaderInput;
declare const inputs: readonly ShaderInput[];
const output = { width: 128, height: 128 };

// schemaの入力名を推論し、キーの誤記・不足・余分なキーを検出する。
function infersInputNames() {
	const pipelines = createShaderInputPipeline({ device, vertex, code: '', schema: { background: 'color' }, targets: [] });
	pipelines.update({ background: input }, output);
	// @ts-expect-error schemaに存在しないキー
	pipelines.update({ foo: input }, output);
	// @ts-expect-error 必須の入力がない
	pipelines.update({}, output);
	// @ts-expect-error 正しい入力があっても余分なキーは認めない
	pipelines.update({ background: input, foo: input }, output);
	// @ts-expect-error 単一入力には配列を渡せない
	pipelines.update({ background: inputs }, output);
}

// as constなしでも配列schemaを推論し、単一入力との混在とreadonly配列を扱う。
function infersArrayInputs() {
	const pipelines = createShaderInputPipeline({ device, vertex, code: '', schema: { images: { array: 'color' }, amount: 'scalar' }, targets: [] });
	pipelines.update({ images: inputs, amount: input }, output);
	pipelines.update({ images: [], amount: input }, output);
	// @ts-expect-error 配列入力に単一入力を渡せない
	pipelines.update({ images: input, amount: input }, output);
	// @ts-expect-error 配列でもschemaに指定した入力は必須
	pipelines.update({ amount: input }, output);
}

void infersInputNames;
void infersArrayInputs;
