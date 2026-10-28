import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { bundleSource, loadShaderSource } from './helpers/load-shader-source.mjs';

const { CpuPreviewFrameQueue } = await loadShaderSource(fileURLToPath(new URL('../src/cpu-preview-frame-queue.ts', import.meta.url)));
const { CpuPreviewCanvasContext, copyPreviewPixels } = await loadShaderSource(fileURLToPath(new URL('../src/preview-canvas-context.ts', import.meta.url)));

function pixelConversionFixture({ blueFirst, opaque, sourceOffset = 4, destinationOffset = 8, bytesPerRow = 80, sourceExtraBytes = 0, destinationExtraBytes = 0 }) {
	const width = 16; const height = 16;
	const sourceBytes = new Uint8Array(sourceOffset + bytesPerRow * height + sourceExtraBytes + 7).fill(0xa5);
	const source = new Uint8Array(sourceBytes.buffer, sourceOffset, bytesPerRow * height + sourceExtraBytes);
	const destinationBytes = new Uint8Array(destinationOffset + width * height * 4 + destinationExtraBytes + 7).fill(0x6a);
	const destination = new Uint8ClampedArray(destinationBytes.buffer, destinationOffset, width * height * 4 + destinationExtraBytes);
	const expected = destinationBytes.slice();
	for (let index = 0; index < width * height; index++) {
		const alpha = opaque ? 255 : index;
		const red = (index * 29 + 17) % 256; const green = (index * 43 + 3) % 256; const blue = (index * 71 + 251) % 256;
		source.set(blueFirst ? [blue, green, red, alpha] : [red, green, blue, alpha], Math.floor(index / width) * bytesPerRow + index % width * 4);
		// byte経路の数値仕様を基準にし、32bitのmaskやshiftを期待値の生成には使わない。
		const factor = alpha === 0 ? 0 : 255 / alpha;
		expected.set(new Uint8ClampedArray([red * factor, green * factor, blue * factor, alpha]), destinationOffset + index * 4);
	}
	const originalSource = sourceBytes.slice();
	return { source, destination, width, height, bytesPerRow, verify() {
		assert.deepEqual(destinationBytes, expected);
		assert.deepEqual(sourceBytes, originalSource);
	} };
}

// 【32bit経路でもRGBA・BGRAと全alpha値の変換結果を変えない】
// 不透明な動画だけでなく、半透明・完全透明を混ぜた出力も同じ関数を通る。
// 行paddingと非ゼロのbyteOffsetを使い、範囲外を書き換えないことも検証する。
test('preserves packed opaque pixels and every alpha value in both channel orders', () => {
	for (const blueFirst of [false, true]) for (const opaque of [false, true]) {
		const f = pixelConversionFixture({ blueFirst, opaque });
		copyPreviewPixels(f.source, f.destination, f.width, f.height, f.bytesPerRow, blueFirst);
		f.verify();
	}
});

// 【32bit viewを作れない開始位置・長さ・行幅ではbyte経路を使う】
// Uint32Arrayの制約を満たさないsubarrayでも例外や画素ずれを起こしてはいけない。
// 入出力の各制約を個別に崩し、フォールバックの条件漏れを検出する。
test('converts unaligned views and row strides without accessing surrounding bytes', () => {
	for (const layout of [{ sourceOffset: 1 }, { destinationOffset: 1 }, { bytesPerRow: 81 }, { sourceExtraBytes: 1 }, { destinationExtraBytes: 1 }]) {
		for (const blueFirst of [false, true]) for (const opaque of [false, true]) {
			const f = pixelConversionFixture({ ...layout, blueFirst, opaque });
			copyPreviewPixels(f.source, f.destination, f.width, f.height, f.bytesPerRow, blueFirst);
			f.verify();
		}
	}
});

// 【little endian以外では32bitのチャンネル位置を仮定しない】
// このテスト環境のCPUに依存せず、byte順の検出だけをbig endianとして評価する。
// 以降の32bit view生成は失敗させ、byte経路だけで同じ画素を得られることを確認する。
test('uses byte conversion when the native word order is not little endian', async () => {
	class BigEndianProbe extends Uint32Array {
		constructor(values) {
			if (!Array.isArray(values)) throw new Error('Packed pixel views must not be used');
			super(values.length);
			const data = new DataView(this.buffer);
			for (let index = 0; index < values.length; index++) data.setUint32(index * 4, values[index], false);
		}
	}
	const compiled = await bundleSource(fileURLToPath(new URL('../src/preview-canvas-context.ts', import.meta.url)));
	const module = { exports: {} };
	new Function('module', 'exports', 'Uint32Array', compiled.outputFiles[0].text)(module, module.exports, BigEndianProbe);
	for (const blueFirst of [false, true]) for (const opaque of [false, true]) {
		const f = pixelConversionFixture({ blueFirst, opaque });
		module.exports.copyPreviewPixels(f.source, f.destination, f.width, f.height, f.bytesPerRow, blueFirst);
		f.verify();
	}
});

// 【行の隙間・BGRA順・乗算済みalphaをCanvas 2D用のRGBAへ変換する】
// 0.25xなどの行幅にはGPUコピー用のpaddingが入る。上下の取り違えや、
// 透明画素の残色、二重のalpha乗算による暗い輪郭も画素値で検出する。
test('converts padded premultiplied BGRA rows into straight RGBA', () => {
	const source = new Uint8Array(32);
	source.set([16, 32, 64, 128, 80, 70, 60, 0]);
	source.set([30, 20, 10, 255, 255, 255, 255, 255], 16);
	const destination = new Uint8ClampedArray(16);
	copyPreviewPixels(source, destination, 2, 2, 16, true);
	assert.deepEqual([...destination], [128, 64, 32, 128, 0, 0, 0, 0, 10, 20, 30, 255, 255, 255, 255, 255]);
	copyPreviewPixels(new Uint8Array([10, 20, 30, 255]), destination.subarray(0, 4), 1, 1, 4, false);
	assert.deepEqual([...destination.subarray(0, 4)], [10, 20, 30, 255]);
});

function fixture(t) {
	for (const [key, value] of Object.entries({ GPUTextureUsage: { RENDER_ATTACHMENT: 1, COPY_SRC: 2 }, GPUBufferUsage: { COPY_DST: 1, MAP_READ: 2 }, GPUMapMode: { READ: 1 } })) {
		const original = Object.getOwnPropertyDescriptor(globalThis, key);
		Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
		t.after(() => { if (original == null) delete globalThis[key]; else Object.defineProperty(globalThis, key, original); });
	}
	const displayed = [];
	const pixelBuffers = [];
	const canvas = { width: 3, height: 2 };
	const buffers = [];
	const textures = [];
	const device = {
		createTexture({ size }) { const texture = { width: size[0], height: size[1], destroy() {} }; textures.push(texture); return texture; },
		createBuffer({ size }) {
			const buffer = { size, bytes: new ArrayBuffer(size), pending: Promise.withResolvers(), mapState: 'unmapped', destroyed: false,
				mapAsync() { this.mapState = 'pending'; return this.pending.promise.then(() => { this.mapState = 'mapped'; }); },
				getMappedRange() { return this.bytes; }, unmap() { this.mapState = 'unmapped'; this.pending = Promise.withResolvers(); }, destroy() { this.destroyed = true; },
			}; buffers.push(buffer); return buffer;
		},
	};
	const copies = [];
	const encoder = { copyTextureToBuffer(source, destination, size) { copies.push({ source, destination, size }); } };
	const context = new CpuPreviewCanvasContext(canvas, frame => { displayed.push([...new Uint8ClampedArray(frame.pixels)]); pixelBuffers.push(frame.pixels); });
	context.configure({ device, format: 'rgba8unorm' });
	context.getCurrentTexture();
	t.after(() => context.unconfigure());
	return { context, canvas, buffers, textures, copies, encoder, displayed, pixelBuffers, prepareReadback: () => context.prepareReadback(encoder, () => {}) };
}

// 【読み戻しの完了順が逆でも最新画像を巻き戻さず、完了後のバッファを再利用する】
// 先行フレームを許すと複数のmapAsyncが並ぶ。個別バッファへコピーし、
// 古い完了通知の表示を防ぎつつ毎フレームのGPUバッファ確保を避ける必要がある。
test('keeps the newest completed image and reuses readback buffers', async t => {
	const f = fixture(t);
	const first = f.prepareReadback().complete();
	const second = f.prepareReadback().complete();
	assert.equal(f.copies[0].destination.bytesPerRow, 256);
	assert.equal(f.buffers[0].size, 512);
	new Uint8Array(f.buffers[1].bytes).set([40, 50, 60, 255]);
	f.buffers[1].pending.resolve(); await second;
	f.buffers[0].pending.resolve(); await first;
	assert.equal(f.displayed.length, 1);
	assert.deepEqual(f.displayed[0].slice(0, 4), [40, 50, 60, 255]);
	const third = f.prepareReadback().complete();
	assert.equal(f.buffers.length, 2);
	f.buffers[0].pending.resolve(); await third;
	assert.equal(f.displayed.length, 2);
});

// 【サイズ変更・破棄前に開始した読み戻しを表示せず、旧資源を解放する】
// 設定の切り替えやプレビュー解像度の変更はGPUコピー中にも起こる。
// 古い寸法の画像を再表示したり、意図した破棄を描画失敗として報告しないことを確認する。
test('discards obsolete dimensions and suppresses intentional disposal failures', async t => {
	const f = fixture(t);
	const oldFrame = f.prepareReadback().complete();
	f.canvas.width = 5; f.context.getCurrentTexture();
	f.buffers[0].pending.resolve(); await oldFrame;
	assert.equal(f.displayed.length, 0);
	assert.equal(f.buffers[0].destroyed, true);
	const pending = f.prepareReadback().complete();
	f.context.unconfigure();
	f.buffers[1].pending.reject(new Error('Buffer was destroyed'));
	await pending;
	assert.equal(f.displayed.length, 0);
	assert.equal(f.buffers[1].destroyed, true);
});

// 【有効な出力での読み戻し失敗は呼び出し側へ通知する】
// GPUの障害を黙って無視すると、再生だけ進んでプレビューが静止し続けてしまう。
test('propagates readback errors while the output is active', async t => {
	const f = fixture(t);
	const pending = f.prepareReadback().complete();
	f.buffers[0].pending.reject(new Error('Readback failed'));
	await assert.rejects(pending, /Readback failed/);
});

// 【表示側から返却されたピクセル領域だけを再利用する】
// 転送直後の領域はUIの所有物なので、再描画時に上書きしてはいけない。
// 返却された同じ寸法の領域を使い、解像度変更前の領域は保持しないことを確認する。
test('recycles only returned pixel buffers with the current dimensions', async t => {
	const f = fixture(t);
	const render = async () => { const completion = f.prepareReadback().complete(); f.buffers.at(-1).pending.resolve(); await completion; };
	await render();
	const pixels = f.pixelBuffers[0];
	f.context.recyclePixels(0, pixels);
	await render();
	assert.equal(f.pixelBuffers[1], pixels);
	f.canvas.width = 5; f.context.getCurrentTexture();
	f.context.recyclePixels(1, pixels);
	await render();
	assert.notEqual(f.pixelBuffers[2], pixels);
	assert.equal(f.pixelBuffers[2].byteLength, 5 * 2 * 4);
});

// 【GPU読み戻しが終わってもUIの返却まで表示枠を予約したままにする】
// 描画前の判定から返却まで一つの上限で制御し、表示できない画像の評価・描画を防ぐ。
test('holds reservations until UI acknowledgment rather than readback completion', async t => {
	const f = fixture(t);
	const queue = new CpuPreviewFrameQueue([f.context]); t.after(() => queue.destroy());
	for (let index = 0; index < 2; index++) {
		const frame = queue.tryReserveFrame(); frame.prepareReadback(f.encoder);
		const completion = frame.complete(); f.buffers[0].pending.resolve(); await completion;
	}
	assert.equal(queue.tryReserveFrame(), null);
	f.context.recyclePixels(0, f.pixelBuffers[0]);
	const frame = queue.tryReserveFrame(); assert.notEqual(frame, null);
	frame.cancel();
});

// 【全出力が返却されるまで次の表示枠を解放しない】
// 主映像だけが速く返っても、ヒストグラムや波形の転送画像を積み上げないようにする。
test('keeps a frame reserved until every output has been returned', async t => {
	const outputs = [fixture(t), fixture(t)];
	const queue = new CpuPreviewFrameQueue(outputs.map(f => f.context)); t.after(() => queue.destroy());
	const reserved = queue.tryReserveFrame(); reserved.prepareReadback(outputs[0].encoder);
	const completion = reserved.complete();
	for (const f of outputs) f.buffers[0].pending.resolve();
	await completion;
	const second = queue.tryReserveFrame();
	outputs[0].context.recyclePixels(0, outputs[0].pixelBuffers[0]);
	assert.equal(queue.tryReserveFrame(), null);
	outputs[1].context.recyclePixels(0, outputs[1].pixelBuffers[0]);
	assert.notEqual(queue.tryReserveFrame(), null);
	second.cancel();
});

// 【未記録の予約はリサイズでも維持し、送信失敗の解放で待機を再開する】
// 出力寸法はノード評価後に決まる。予約は旧サイズの画像に結び付けず、
// encoderの破棄やsubmitの失敗では読み戻しを開始せず資源を解放する。
test('preserves a pre-render reservation across resize and cancels unsubmitted copies', async t => {
	const f = fixture(t);
	const queue = new CpuPreviewFrameQueue([f.context]); t.after(() => queue.destroy());
	const frame = queue.tryReserveFrame(); const second = queue.tryReserveFrame();
	let resumed = false;
	const waiting = queue.reserveFrame().then(value => { resumed = true; return value; });
	await Promise.resolve(); assert.equal(resumed, false);
	f.canvas.width = 5; f.context.getCurrentTexture();
	frame.prepareReadback(f.encoder);
	assert.equal(f.copies[0].size[0], 5);
	assert.equal(resumed, false);
	frame.cancel(); assert.equal(f.buffers[0].destroyed, true);
	assert.equal(frame.isCancelled, true);
	const next = await waiting; assert.notEqual(next, null);
	assert.equal(f.displayed.length, 0);
	second.cancel(); next.cancel();
});

// 【返却待ちの終了時に古い描画を開始せず、破棄時にも待機を残さない】
// 読み戻し容量を待つTimelineがWorker終了時に永久待機しないことを確認する。
test('releases capacity waiters when the queue is destroyed', async t => {
	const f = fixture(t);
	const queue = new CpuPreviewFrameQueue([f.context]);
	queue.tryReserveFrame(); queue.tryReserveFrame();
	const waiting = queue.reserveFrame();
	queue.destroy();
	assert.equal(await waiting, null);
	assert.equal(queue.tryReserveFrame(), null);
});

// 【コピー記録の失敗でも確保済みbufferと予約を回収する】
// mapAsyncに到達する前の例外は、非同期完了のfinallyだけでは解放できない。
test('releases readbacks and reservations when encoding fails', t => {
	const f = fixture(t);
	const queue = new CpuPreviewFrameQueue([f.context]); t.after(() => queue.destroy());
	const frame = queue.tryReserveFrame();
	assert.throws(() => frame.prepareReadback({ copyTextureToBuffer() { throw new Error('Copy failed'); } }), /Copy failed/);
	assert.equal(f.buffers[0].destroyed, true);
	assert.notEqual(queue.tryReserveFrame(), null);
});

// 【UI返却待ちの画像を取り消しても、既に再利用中のGPU bufferを破棄しない】
// 読み戻しbufferはUIへの送信後にプールへ戻り、ピクセルの返却より先に次の描画へ使われる。
test('does not destroy a reused buffer when an older presentation is cancelled', async t => {
	const f = fixture(t);
	const queue = new CpuPreviewFrameQueue([f.context]); t.after(() => queue.destroy());
	const first = queue.tryReserveFrame(); first.prepareReadback(f.encoder);
	const firstCompletion = first.complete(); f.buffers[0].pending.resolve(); await firstCompletion;
	const second = queue.tryReserveFrame(); second.prepareReadback(f.encoder);
	const secondCompletion = second.complete();
	first.cancel();
	assert.equal(f.buffers[0].destroyed, false);
	f.buffers[0].pending.resolve(); await secondCompletion;
	assert.equal(f.displayed.length, 2);
});
