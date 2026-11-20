import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';

// 【静止画とその下流は、fit が変わったフレームだけ再描画する】
// 時刻だけが進んでも描画パスは不要だが、fit を変えたときは下流の画素まで更新する必要がある。
test('reuses a still image and its downstream output until fit changes', { skip: process.env.CHROME_PATH == null }, () =>
	runEffectGpuTest(new URL('./image-browser.mjs', import.meta.url), 'renderStillImage'));
