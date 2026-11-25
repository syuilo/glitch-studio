import type { SpectrogramViewport } from '@gs/subsystems_audio_spectrogram-renderer/spectrogram-renderer.ts';
import type { SpectrogramSettings } from '@gs/subsystems_audio_spectrogram-renderer/spectrogram-settings.ts';

export type MonitorSettings = { overlay: boolean; waveformSeconds: number };
export type PreviewSpectrogramSettings = Omit<SpectrogramSettings, 'maxFrequency'> & { maxFrequency: number | null };
export type PreviewSpectrogramOptions = { mode: 'spectrogram'; settings: PreviewSpectrogramSettings; viewport: SpectrogramViewport; hold: boolean };
export type PreviewOptions =
	| { mode: 'spectrum' | 'waveform'; settings: MonitorSettings }
	| PreviewSpectrogramOptions;
export type PreviewSize = { width: number; height: number; ratio: number; visible: boolean };
export type MeterReading = { id: number; generation: number; left: number; right: number };
export type PreviewRequest =
	| { type: 'add'; id: number; canvas: OffscreenCanvas; options: PreviewOptions }
	| { type: 'options'; id: number; options: PreviewOptions }
	| ({ type: 'resize'; id: number } & PreviewSize)
	| { type: 'remove'; id: number }
	| { type: 'audio'; port: MessagePort }
	| { type: 'resetAudio' }
	| { type: 'running'; running: boolean }
	| { type: 'renderingSuspended'; suspended: boolean; requestId: number | null }
	| { type: 'meter'; id: number; port: MessagePort }
	| { type: 'removeMeter'; id: number }
	| { type: 'metersReceived' };
export type PreviewResponse =
	| { type: 'meters'; readings: MeterReading[] }
	| { type: 'sampleRate'; sampleRate: number }
	| { type: 'spectrogramSampleRate'; id: number; sampleRate: number }
	| { type: 'renderingStateApplied'; requestId: number }
	| { type: 'error'; id?: number; message: string };
