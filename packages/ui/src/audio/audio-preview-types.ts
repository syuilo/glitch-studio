import type { SpectrogramSettings } from '@glitch/shared/utility/audio-spectrogram/audio-spectrogram.ts';

export type MonitorSettings = { overlay: boolean; waveformSeconds: number };
export type PreviewOptions =
	| { mode: 'spectrum' | 'waveform'; settings: MonitorSettings }
	| { mode: 'spectrogram'; settings: SpectrogramSettings };
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
	| { type: 'meter'; id: number; port: MessagePort }
	| { type: 'removeMeter'; id: number }
	| { type: 'metersReceived' };
export type PreviewResponse =
	| { type: 'meters'; readings: MeterReading[] }
	| { type: 'sampleRate'; sampleRate: number }
	| { type: 'error'; id?: number; message: string };
