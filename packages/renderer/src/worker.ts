import { effectDefinitions } from '@glitch/shared/effect-definitions.ts';
import { effectImplementations } from '@glitch/shared/effect-implementations.js';
import { MainRenderer } from './renderer.ts';

let renderer: MainRenderer | null = null;
let canvas: OffscreenCanvas | null = null;
let histogramCanvas: OffscreenCanvas | null = null;
let waveformHorizontalCanvas: OffscreenCanvas | null = null;
let waveformVerticalCanvas: OffscreenCanvas | null = null;

setInterval(() => {
	if (renderer == null) return;
	self.postMessage({ type: 'stats', stats: {
		fpsAverage: renderer.fpsAverage.get(),
		gpuAverageFast: renderer.gpuAverageFast.get(),
		gpuAverageMedium: renderer.gpuAverageMedium.get(),
		gpuAverageSlow: renderer.gpuAverageSlow.get(),
	} });
}, 100);

function reportGpuMemory() {
	if (renderer == null) return;
	self.postMessage({ type: 'gpuMemory', usage: renderer.gpuMemory.getUsage() });
}

setInterval(reportGpuMemory, 1000);

onmessage = async (event) => {
	//console.log('Worker received message:', event.data);

	switch (event.data?.type) {
		case 'init': {
			canvas = event.data.canvas as OffscreenCanvas;
			histogramCanvas = event.data.histogramCanvas as OffscreenCanvas;
			waveformHorizontalCanvas = event.data.waveformHorizontalCanvas as OffscreenCanvas;
			waveformVerticalCanvas = event.data.waveformVerticalCanvas as OffscreenCanvas;

			const adapter = await navigator.gpu?.requestAdapter({
				powerPreference: 'high-performance',
			});

			const device = await adapter?.requestDevice({
				requiredFeatures: [
					...(event.data.options.enable32bitDataTextures ? ['float32-filterable'] as const : []),
					...(event.data.options.enableStats ? ['timestamp-query'] as const : []),
				],
			});
			if (device == null) {
				//window.alert('need a browser that supports WebGPU');
				throw new Error('need a browser that supports WebGPU');
			}

			const context = canvas.getContext('webgpu');
			const histogramContext = histogramCanvas.getContext('webgpu');
			const waveformHorizontalContext = waveformHorizontalCanvas.getContext('webgpu');
			const waveformVerticalContext = waveformVerticalCanvas.getContext('webgpu');
			if (context == null || histogramContext == null || waveformHorizontalContext == null || waveformVerticalContext == null) {
				//window.alert('cannot get webgpu context');
				throw new Error('cannot get webgpu context');
			}

			renderer = new MainRenderer({
				onEffectStatus: (nodeId, status) => self.postMessage({ type: 'effectStatus', nodeId, status }),
				gpuDevice: device,
				gpuContext: context,
				resolution: event.data.options.resolution,
				enable32bitDataTextures: event.data.options.enable32bitDataTextures,
				intermediateTextureFormat: event.data.options.intermediateTextureFormat,
				enableStats: event.data.options.enableStats,
				highlightClipping: event.data.options.highlightClipping,
				liveTimeFactor: event.data.options.liveTimeFactor,
				fpsLimit: event.data.options.fpsLimit,
				assets: event.data.options.assets,
				automations: event.data.options.automations,
				visualModules: event.data.options.visualModules,
				timeline: event.data.options.timeline,
				histogramGpuContext: histogramContext,
				waveformHorizontalGpuContext: waveformHorizontalContext,
				waveformVerticalGpuContext: waveformVerticalContext,
				effectDefinitions: effectDefinitions,
				effectImplementations: effectImplementations,
			});

			//renderer.on('ev', ({ type, ctx }) => {
			//	self.postMessage({ type: 'ev', ev: { type, ctx } });
			//});

			//await renderer.init();

			self.postMessage({ type: 'inited' });
			reportGpuMemory();
			break;
		}
		case 'resize': {
			if (canvas == null) return;
			canvas.width = event.data.resolution.width;
			canvas.height = event.data.resolution.height;
			if (renderer != null) renderer.resize(event.data.resolution);
			break;
		}
		case 'videoFrame': {
			const { playerId, id, frame } = event.data;
			try {
				if (renderer) {
					renderer.updateVideoFrame(playerId, frame);
				} else {
					frame.close();
				}
			} finally {
				self.postMessage({ type: 'videoFrameReceived', playerId, id });
			}
			break;
		}
		case 'call': {
			if (renderer == null) {
				console.error('Failed to call: Renderer is not initialized yet!!!');
				break;
			}
			const res = renderer[event.data.fn](...(event.data.args ?? []));
			if (event.data.needReturnValue) {
				if (res instanceof Promise) {
					res.then((r) => {
						self.postMessage({ type: 'return', id: event.data.id, value: r });
					});
				} else {
					self.postMessage({ type: 'return', id: event.data.id, value: res });
				}
			}
			break;
		}
		default: {
			console.warn('Unrecognized message type:', event.data?.type);
		}
	}
};
