import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEffectGpuTest } from './run-effect-gpu-test.mjs';
import { writeFile } from 'node:fs/promises';

// 【近接ネットワークの生成・投影・合成を実際のWebGPUで検証する】
// 既知の点群の近傍をCPUの距離順ソートと照合し、接続数・同距離の選択を確認する。
// 画面/3D空間の寸法、前後関係、HDR、シーク、Nearクリッピングも実装を通して検証する。
test('renders deterministic proximity networks with camera and size spaces on WebGPU', { skip: process.env.CHROME_PATH == null, timeout: 60000 }, async t => {
	const output = await runEffectGpuTest(new URL('./helpers/point-network-3d-gpu.ts', import.meta.url), 'run', 45000, [process.env.POINT_NETWORK_3D_PREVIEW_PATH != null]);
	assert.equal(output.checks.length, 10);
	if (process.env.POINT_NETWORK_3D_PREVIEW_PATH != null) await writeFile(process.env.POINT_NETWORK_3D_PREVIEW_PATH, Buffer.from(output.preview, 'base64'));
	t.diagnostic(`${output.checks.length} checks: ${output.checks.join(', ')}`);
});
