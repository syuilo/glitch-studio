import colorSpaceShaderCode from '@gs/shared/gpu/color-space.wgsl?raw';
import commonShaderCode from './common.wgsl?raw';
import { VHS_SIGNAL } from './signal.ts';

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
}).map(([name, value]) => `const ${name}: ${typeof value === 'string' ? 'u32' : 'f32'} = ${value};`).join('\n');

export default constants + '\n' + colorSpaceShaderCode + '\n' + commonShaderCode;
