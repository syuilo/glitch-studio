import { SPECTRAL_SAMPLE_COUNT } from '../../optics/spectral-samples.ts';
import shaderCode from './shader.wgsl?raw';

export default `const SPECTRAL_SAMPLE_COUNT = ${SPECTRAL_SAMPLE_COUNT}u;\n` + shaderCode;
