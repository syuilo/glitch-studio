import { AudioHistory } from '@glitch/shared/audio-history.ts';
import { createAudioSpectrogram } from '@glitch/shared/utility/audio-spectrogram/audio-spectrogram.ts';
import { createPreviewSpectrum } from './audio-preview-spectrum.ts';
import { createPreviewWaveform } from './audio-preview-waveform.ts';
import type { AudioCaptureMessage } from '@glitch/shared/audio.ts';
import type { MeterReading, PreviewOptions, PreviewRequest, PreviewResponse, PreviewSize } from './audio-preview-types.ts';

type Panel = {
	canvas: OffscreenCanvas;
	options: PreviewOptions;
	size: PreviewSize;
	context?: GPUCanvasContext;
	spectrogram?: ReturnType<typeof createAudioSpectrogram>;
	spectrum?: ReturnType<typeof createPreviewSpectrum>;
	waveform?: ReturnType<typeof createPreviewWaveform>;
};
const panels = new Map<number, Panel>();
const meters = new Map<number, MessagePort>();
const readings = new Map<number, MeterReading>();
const history = new AudioHistory();
let audioPort: MessagePort | undefined;
let running = false;
let meterPending = false;
let device: GPUDevice | undefined;
let deviceReady: Promise<GPUDevice> | undefined;
let vertex: GPUShaderModule | undefined;

function send(message: PreviewResponse) { self.postMessage(message); }

function removePanel(id: number) {
	const panel = panels.get(id);
	if (!panel) return;
	panel.spectrogram?.dispose();
	panel.spectrum?.dispose();
	panel.waveform?.dispose();
	panel.context?.unconfigure();
	panels.delete(id);
}

function configurePanel(panel: Panel) {
	if (!device || !panel.context) return;
	panel.spectrogram?.dispose();
	panel.spectrum?.dispose();
	panel.waveform?.dispose();
	panel.spectrogram = undefined;
	panel.spectrum = undefined;
	panel.waveform = undefined;
	if (panel.options.mode === 'spectrogram') panel.spectrogram = createAudioSpectrogram(device, vertex!);
	else if (panel.options.mode === 'spectrum') panel.spectrum = createPreviewSpectrum(device);
	else panel.waveform = createPreviewWaveform(device);
}

function gpu() {
	deviceReady ??= (async () => {
		const adapter = await navigator.gpu?.requestAdapter();
		if (!adapter) throw new Error('WebGPU is unavailable.');
		const created = await adapter.requestDevice();
		device = created;
		created.addEventListener('uncapturederror', event => {
			if (device !== created) return;
			for (const id of [...panels.keys()]) removePanel(id);
			send({ type: 'error', message: event.error.message });
		});
		vertex = created.createShaderModule({ code: `
struct VertexOut { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) index: u32) -> VertexOut {
	let positions = array(vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1));
	return VertexOut(vec4f(positions[index], 0, 1), positions[index]);
}` });
		void created.lost.then(info => {
			if (device !== created) return;
			for (const id of [...panels.keys()]) removePanel(id);
			device = undefined;
			deviceReady = undefined;
			send({ type: 'error', message: info.message || 'Audio preview GPU device was lost.' });
		});
		return created;
	})().catch(error => { deviceReady = undefined; throw error; });
	return deviceReady;
}

async function addPanel(id: number, panel: Panel) {
	panels.set(id, panel);
	try {
		const created = await gpu();
		if (panels.get(id) !== panel) return;
		const context = panel.canvas.getContext('webgpu');
		if (!context) throw new Error('Could not create an audio preview canvas context.');
		panel.context = context;
		context.configure({ device: created, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: 'premultiplied' });
		configurePanel(panel);
	} catch (error) {
		if (panels.get(id) !== panel) return;
		removePanel(id);
		send({ type: 'error', id, message: String(error) });
	}
}

onmessage = ({ data }: MessageEvent<PreviewRequest>) => {
	switch (data.type) {
		case 'add':
			void addPanel(data.id, { canvas: data.canvas, options: data.options, size: { width: 0, height: 0, ratio: 1, visible: false } });
			break;
		case 'remove': removePanel(data.id); break;
		case 'options': {
			const panel = panels.get(data.id);
			if (panel) {
				const changedMode = panel.options.mode !== data.options.mode;
				panel.options = data.options;
				if (changedMode) {
					try { configurePanel(panel); }
					catch (error) { removePanel(data.id); send({ type: 'error', id: data.id, message: String(error) }); }
				}
			}
			break;
		}
		case 'resize': {
			const panel = panels.get(data.id);
			if (panel) panel.size = data;
			break;
		}
		case 'audio': {
			audioPort?.close();
			history.reset();
			const port = data.port;
			audioPort = port;
			port.onmessage = ({ data: message }: MessageEvent<AudioCaptureMessage>) => {
				if (audioPort !== port) return;
				if (message.type === 'reset') history.reset(message.generation);
				else {
					const rate = history.sampleRate;
					try { history.append(message); }
					finally { port.postMessage({ type: 'recycle', buffer: message.buffer }, [message.buffer]); }
					if (rate !== history.sampleRate) send({ type: 'sampleRate', sampleRate: history.sampleRate });
				}
			};
			break;
		}
		case 'resetAudio': audioPort?.close(); audioPort = undefined; history.reset(); break;
		case 'running': running = data.running; break;
		case 'meter': {
			const { id, port } = data;
			meters.set(id, port);
			port.onmessage = ({ data: reading }: MessageEvent<Omit<MeterReading, 'id'>>) => {
				if (meters.get(id) !== port) return;
				const previous = readings.get(id);
				// 通知待ちの間もピークを保持し、UI復帰時に古い通知を連続配送しない。
				readings.set(id, { id, generation: reading.generation,
					left: Math.max(reading.left, previous?.generation === reading.generation ? previous.left : 0),
					right: Math.max(reading.right, previous?.generation === reading.generation ? previous.right : 0) });
				port.postMessage({ type: 'meterReceived' });
			};
			break;
		}
		case 'removeMeter': meters.get(data.id)?.close(); meters.delete(data.id); readings.delete(data.id); break;
		case 'metersReceived': meterPending = false; break;
	}
};

setInterval(() => {
	if (meterPending || readings.size === 0) return;
	meterPending = true;
	send({ type: 'meters', readings: [...readings.values()] });
	readings.clear();
}, 1000 / 30);

// 描画はブラウザーのリフレッシュ周期に合わせる。FFTの解析間隔・平滑化・履歴の進行は
// PCMのサンプル時刻を基準にするため、描画FPSが変わっても時間スケールは変わらない。
// 非表示のパネルでは解析も描画も行わない。
function drawFrame() {
	self.requestAnimationFrame(drawFrame);
	if (!device) return;
	for (const [id, panel] of panels) {
		const { width, height, ratio, visible } = panel.size;
		if (!visible || width <= 0 || height <= 0 || !panel.context) continue;
		try {
			const limit = device.limits.maxTextureDimension2D;
			const pixelWidth = Math.min(limit, Math.max(1, Math.round(width * ratio)));
			const pixelHeight = Math.min(limit, Math.max(1, Math.round(height * ratio)));
			if (panel.canvas.width !== pixelWidth) panel.canvas.width = pixelWidth;
			if (panel.canvas.height !== pixelHeight) panel.canvas.height = pixelHeight;
			const encoder = device.createCommandEncoder();
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view: panel.context.getCurrentTexture().createView(),
				loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
			const options = panel.options;
			if (options.mode === 'spectrogram') panel.spectrogram!.render(history, options.settings, pass);
			else if (options.mode === 'spectrum') panel.spectrum!.render(running ? history : null, options.settings, pass, width);
			else panel.waveform!.render(running ? history : null, options.settings, pass, width, pixelHeight);
			pass.end();
			device.queue.submit([encoder.finish()]);
		} catch (error) {
			removePanel(id);
			send({ type: 'error', id, message: String(error) });
		}
	}
}

self.requestAnimationFrame(drawFrame);
