import { MAX_ANGULAR_BLUR_SAMPLES } from './sampling.ts';
import shaderCode from './shader.wgsl?raw';

export default `const MAX_ANGULAR_BLUR_SAMPLES = ${MAX_ANGULAR_BLUR_SAMPLES}u;\n` + shaderCode;
