import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

const { CpuPreviewCanvasContext, copyPreviewPixels } = await loadShaderSource(fileURLToPath(new URL('../src/preview-canvas-context.ts', import.meta.url)));

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
	return { context, canvas, buffers, textures, copies, encoder, displayed, pixelBuffers };
}

// 【読み戻しの完了順が逆でも最新画像を巻き戻さず、完了後のバッファを再利用する】
// 先行フレームを許すと複数のmapAsyncが並ぶ。個別バッファへコピーし、
// 古い完了通知の表示を防ぎつつ毎フレームのGPUバッファ確保を避ける必要がある。
test('keeps the newest completed image and reuses readback buffers', async t => {
	const f = fixture(t);
	const first = f.context.prepareReadback(f.encoder)();
	const second = f.context.prepareReadback(f.encoder)();
	assert.equal(f.copies[0].destination.bytesPerRow, 256);
	assert.equal(f.buffers[0].size, 512);
	new Uint8Array(f.buffers[1].bytes).set([40, 50, 60, 255]);
	f.buffers[1].pending.resolve(); await second;
	f.buffers[0].pending.resolve(); await first;
	assert.equal(f.displayed.length, 1);
	assert.deepEqual(f.displayed[0].slice(0, 4), [40, 50, 60, 255]);
	const third = f.context.prepareReadback(f.encoder)();
	assert.equal(f.buffers.length, 2);
	f.buffers[0].pending.resolve(); await third;
	assert.equal(f.displayed.length, 2);
});

// 【サイズ変更・破棄前に開始した読み戻しを表示せず、旧資源を解放する】
// 設定の切り替えやプレビュー解像度の変更はGPUコピー中にも起こる。
// 古い寸法の画像を再表示したり、意図した破棄を描画失敗として報告しないことを確認する。
test('discards obsolete dimensions and suppresses intentional disposal failures', async t => {
	const f = fixture(t);
	const oldFrame = f.context.prepareReadback(f.encoder)();
	f.canvas.width = 5; f.context.getCurrentTexture();
	f.buffers[0].pending.resolve(); await oldFrame;
	assert.equal(f.displayed.length, 0);
	assert.equal(f.buffers[0].destroyed, true);
	const pending = f.context.prepareReadback(f.encoder)();
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
	const pending = f.context.prepareReadback(f.encoder)();
	f.buffers[0].pending.reject(new Error('Readback failed'));
	await assert.rejects(pending, /Readback failed/);
});

// 【表示側から返却されたピクセル領域だけを再利用する】
// 転送直後の領域はUIの所有物なので、再描画時に上書きしてはいけない。
// 返却された同じ寸法の領域を使い、解像度変更前の領域は保持しないことを確認する。
test('recycles only returned pixel buffers with the current dimensions', async t => {
	const f = fixture(t);
	const render = async () => { const completion = f.context.prepareReadback(f.encoder)(); f.buffers.at(-1).pending.resolve(); await completion; };
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

// 【UIが受け取った画像を返却するまで、未表示の画像を増やさない】
// GPUのmapAsyncだけを上限にすると、UIが遅いときに転送済み画像が際限なく増える。
test('bounds images awaiting display acknowledgment as well as GPU readbacks', async t => {
	const f = fixture(t);
	for (let index = 0; index < 2; index++) { const completion = f.context.prepareReadback(f.encoder)(); f.buffers[0].pending.resolve(); await completion; }
	assert.equal(f.context.prepareReadback(f.encoder), null);
	f.context.recyclePixels(0, f.pixelBuffers[0]);
	const completion = f.context.prepareReadback(f.encoder)();
	f.buffers[0].pending.resolve(); await completion;
	assert.equal(f.displayed.length, 3);
});

// 【表示待ちが満杯なら領域の返却を待ち、破棄時には待機も解除する】
// 手動シークは最新画像の読み戻しを省略できない。UIの返却待ちで画像を失わず、
// 設定変更による破棄やサイズ変更でも待機を残さないことを確認する。
test('waits for display capacity and releases waiters on invalidation', async t => {
	const f = fixture(t);
	const render = async () => { const completion = f.context.prepareReadback(f.encoder)(); f.buffers[0].pending.resolve(); await completion; };
	await render(); await render();
	let available = false;
	const capacity = f.context.waitForReadbackCapacity().then(() => { available = true; });
	await Promise.resolve(); assert.equal(available, false);
	f.context.recyclePixels(0, f.pixelBuffers[0]);
	await capacity; assert.equal(available, true);
	await render();
	available = false;
	const obsolete = f.context.waitForReadbackCapacity().then(() => { available = true; });
	await Promise.resolve(); assert.equal(available, false);
	f.context.invalidatePendingFrames();
	await obsolete; assert.equal(available, true);
});
