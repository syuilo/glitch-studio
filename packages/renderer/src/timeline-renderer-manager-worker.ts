// Managerクラスのメソッドの呼び出しやイベント通知を行うだけ。独自の処理を追加しないこと！ そうしないとWorkerでの利用と非Workerでの利用で機能に差が生まれることになる

import { effectDefinitions } from '@glitch/effect-shared/effect-definitions.ts';
import { effectImplementations } from '@glitch/effect-shared/effect-implementations.js';
import { createManager, TimelineRendererManager } from './timeline-renderer-manager.ts';

let manager: TimelineRendererManager | null = null;
let canvas: OffscreenCanvas | null = null;
let histogramCanvas: OffscreenCanvas | null = null;
let waveformHorizontalCanvas: OffscreenCanvas | null = null;
let waveformVerticalCanvas: OffscreenCanvas | null = null;

onmessage = async (event) => {
	//console.log('Worker received message:', event.data);

	switch (event.data?.type) {
		case 'init': {
			try {
				canvas = event.data.canvas as OffscreenCanvas;
				histogramCanvas = event.data.histogramCanvas as OffscreenCanvas;
				waveformHorizontalCanvas = event.data.waveformHorizontalCanvas as OffscreenCanvas;
				waveformVerticalCanvas = event.data.waveformVerticalCanvas as OffscreenCanvas;

				manager = await createManager({
					canvas,
					histogramCanvas,
					waveformHorizontalCanvas,
					waveformVerticalCanvas,
					staticOptions: event.data.staticOptions,
					dynamicOptions: event.data.dynamicOptions,
					effectDefinitions,
					effectImplementations,
				});

				manager.on('ev', ({ type, ctx }) => {
					self.postMessage({ type: 'ev', ev: { type, ctx } });
				});

				self.postMessage({ type: 'inited' });
			} catch (error) {
				manager?.destroy();
				manager = null;
				self.postMessage({ type: 'initError', message: error instanceof Error ? error.message : String(error) });
			}
			break;
		}
		case 'call': {
			try {
				if (manager == null) throw new Error('Renderer is not initialized');
				// Worker越しのメッセージは実行時に届くため、呼び出せるメソッドか確認する。
				const method = Reflect.get(manager, event.data.fn);
				if (typeof method !== 'function') throw new Error(`Unknown manager method: ${event.data.fn}`);
				// 戻り値不要の呼び出しもawaitし、非同期の失敗を未処理のrejectにしない。
				const res = await Reflect.apply(method, manager, event.data.args ?? []);
				if (event.data.needReturnValue) {
					self.postMessage({ type: 'return', id: event.data.id, success: true, value: res });
				}
			} catch (error) {
				if (!event.data.needReturnValue) {
					self.postMessage({ type: 'callError', message: error instanceof Error ? error.message : String(error) });
					break;
				}
				// 任意のthrow値には複製できないオブジェクトも含まれるため、エラー情報だけを返す。
				const reason = error instanceof Error ? error : new Error(String(error));
				self.postMessage({ type: 'return', id: event.data.id, success: false, error: {
					name: reason.name, message: reason.message, stack: reason.stack,
				} });
			}
			break;
		}
		default: {
			console.warn('Unrecognized message type:', event.data?.type);
		}
	}
};
