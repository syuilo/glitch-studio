import { MAX_LINEAR_BLUR_SAMPLES } from './sampling.ts';
import shaderCode from './shader.wgsl?raw';

export default `const MAX_LINEAR_BLUR_SAMPLES = ${MAX_LINEAR_BLUR_SAMPLES}u;\n` + shaderCode;
