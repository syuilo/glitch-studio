import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【カタログに登録した全Native Effectの固定入力・固定出力で描画できる】
// 既定値で全ポートを描画し、画像入力を接続した配置では各ポートを単独で描画する。
// WGSLの束縛や未使用attachmentの取り違えと、フレーム中のpipeline再生成を検出する。
test('renders every native effect with fixed inputs and output ports', { skip: process.env.CHROME_PATH == null }, () =>
	runEffectGpuTest(new URL('./native-effect-catalog-browser.mjs', import.meta.url), 'renderCatalog', 120000));

// 【Scalar Gradientが正規化と強度を反映した勾配を出力する】
// pipelineが正常に描画できても、uniformの転送が抜けると勾配の画素値が失われる。
test('renders the scaled derivative of a scalar texture', { skip: process.env.CHROME_PATH == null }, () =>
	runEffectGpuTest(new URL('./native-effect-catalog-browser.mjs', import.meta.url), 'scalarGradient'));
