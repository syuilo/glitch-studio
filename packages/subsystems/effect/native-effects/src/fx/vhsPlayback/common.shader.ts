import colorSpaceShaderCode from '@gs/shared/gpu/color-space.wgsl?raw';
import commonShaderCode from './common.wgsl?raw';
import { VHS_SIGNAL, VHS_TAPE } from './signal.ts';
import { VHS_HEAD_SPACING } from './head-spacing.ts';

// 信号の単位・サンプル数はCPU/GPUで共有し、バッファ配置と同じビルド段階で合成する。
const constants = Object.entries({
	RF_SAMPLES: `${VHS_SIGNAL.rfSamples}u`,
	BASEBAND_SAMPLES: `${VHS_SIGNAL.basebandSamples}u`,
	LINE_COUNT: `${VHS_SIGNAL.lineCount}u`,
	ACTIVE_LINE_START: `${VHS_SIGNAL.activeLineStart}u`,
	ACTIVE_LINE_COUNT: `${VHS_SIGNAL.activeLineCount}u`,
	LINE_PERIOD: VHS_SIGNAL.linePeriod,
	ACTIVE_START: VHS_SIGNAL.activeStart,
	ACTIVE_DURATION: VHS_SIGNAL.activeDuration,
	FM_BLACK: VHS_SIGNAL.fmBlackFrequency,
	FM_DEVIATION: VHS_SIGNAL.fmDeviation,
	CHROMA_FREQUENCY: VHS_SIGNAL.chromaFrequency,
	EMPHASIS: VHS_SIGNAL.emphasis,
	SPACING_RADIUS: `${VHS_HEAD_SPACING.radius}i`,
	SPACING_TAPS: `${VHS_HEAD_SPACING.tapCount}u`,
	SPACING_LEVELS: `${VHS_HEAD_SPACING.levelCount}u`,
	RF_SAMPLES_PER_METER: VHS_SIGNAL.rfSamples / VHS_SIGNAL.linePeriod / VHS_TAPE.relativeSpeedMetersPerSecond,
	TRACK_PITCH: VHS_TAPE.trackPitchMeters,
}).map(([name, value]) => `const ${name}: ${typeof value === 'string' ? value.endsWith('i') ? 'i32' : 'u32' : 'f32'} = ${value};`).join('\n');

const directions = `const TRACK_TANGENT = vec2f(${VHS_TAPE.trackTangent.join(',')});\nconst TRACK_NORMAL = vec2f(${VHS_TAPE.trackNormal.join(',')});`;

export default constants + '\n' + directions + '\n' + colorSpaceShaderCode + '\n' + commonShaderCode;
