import simplexNoiseCode from '../../noise/simplex-noise.wgsl?raw';
import flowNoiseCode from './flow-noise.wgsl?raw';
import shaderCode from './shader.wgsl?raw';

export default simplexNoiseCode + '\n' + flowNoiseCode + '\n' + shaderCode;
