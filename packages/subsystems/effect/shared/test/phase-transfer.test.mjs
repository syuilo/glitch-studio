import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPhaseTransferLayout, createPhaseTransferPasses } from '../src/fx/phaseTransfer/layout.ts';

const settings = { processing: 'global', boundary: 'repeat', analysisResolution: '64', blockResolution: '32', blockSize: 25, sizeReference: 'longSide' };
const limits = { maxStorageBufferBindingSize: 128 * 1024 ** 2, maxBufferSize: 256 * 1024 ** 2, maxComputeWorkgroupsPerDimension: 65535 };

// 【三つのbufferで二つのスペクトルと差分を保持し、FFT段数の奇偶によらず上書きを避ける】
// 主入力のスペクトルを副入力のFFTへ転用すると、画面比率や解析解像度により片方の入力が失われる。
// パス列のデータ依存を追い、移植時に二つの入力が同時に残ることと逆変換の入力を確認する。
test('retains both spectra until transfer across rectangular transform layouts', () => {
	for (const analysisResolution of ['16', '32', '64']) {
		for (const resolution of [{ width: 64, height: 64 }, { width: 128, height: 64 }, { width: 64, height: 128 }]) {
			for (const boundary of ['repeat', 'mirror']) {
				const layout = createPhaseTransferLayout({ ...settings, analysisResolution, boundary }, resolution, limits);
				const plan = createPhaseTransferPasses(layout);
				const contents = [null, null, null];
				let transfers = 0;
				for (const pass of plan.passes) {
					assert.notEqual(pass.source, pass.destination);
					assert.ok(pass.source >= 0 && pass.source < 3 && pass.destination >= 0 && pass.destination < 3);
					if (pass.kind === 'capture') {
						contents[pass.destination] = pass.referenceInput ? 'reference' : 'input';
					} else if (pass.kind === 'transfer') {
						assert.notEqual(pass.reference, pass.source);
						assert.notEqual(pass.reference, pass.destination);
						assert.equal(contents[pass.source], 'input');
						assert.equal(contents[pass.reference], 'reference');
						contents[pass.destination] = 'difference';
						transfers++;
					} else {
						assert.ok(contents[pass.source] != null);
						if (pass.inverse === 1) assert.equal(contents[pass.source], 'difference');
						contents[pass.destination] = contents[pass.source];
					}
				}
				assert.equal(transfers, 1);
				assert.equal(contents[plan.outputBuffer], 'difference');
			}
		}
	}
});

// 【出力解像度を変えても位相移植の解析領域と物理単位を保つ】
// 副入力が加わっても、プレビュー倍率に応じたFFTの変更やブロックの伸縮を行わない。
test('uses the same physical layout at different output resolutions in both processing modes', () => {
	for (const processing of ['global', 'blocks']) {
		for (const boundary of ['repeat', 'mirror']) {
			const params = { ...settings, processing, boundary };
			assert.deepEqual(createPhaseTransferLayout(params, { width: 1920, height: 1080 }, limits), createPhaseTransferLayout(params, { width: 640, height: 360 }, limits));
		}
	}
});

// 【上限は個別buffer・dispatchへ適用し、精度を落とさずエフェクト名付きで拒否する】
// 三つのbufferの合計と個々のbinding上限を取り違えたり、不正なブロック寸法で確保を始めたりしない。
test('validates per-buffer and dispatch limits without reducing phase transfer quality', () => {
	const params = { ...settings, analysisResolution: '16' };
	assert.equal(createPhaseTransferLayout(params, { width: 16, height: 16 }, { ...limits, maxStorageBufferBindingSize: 8192, maxBufferSize: 8192 }).bufferBytes, 8192);
	assert.throws(() => createPhaseTransferLayout(params, { width: 16, height: 16 }, { ...limits, maxStorageBufferBindingSize: 8191 }), /Phase Transfer:.*GPU resource limits/);
	assert.throws(() => createPhaseTransferLayout({ ...params, processing: 'blocks' }, { width: 16, height: 16 }, { ...limits, maxComputeWorkgroupsPerDimension: 4 }), /Phase Transfer:.*GPU resource limits/);
	for (const blockSize of [0, -1, NaN, Infinity, 1e-100]) {
		assert.throws(() => createPhaseTransferLayout({ ...params, processing: 'blocks', blockSize }, { width: 16, height: 16 }, limits), /Phase Transfer:/);
	}
});
