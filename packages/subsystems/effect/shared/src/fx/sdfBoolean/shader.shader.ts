import shapeDistanceCode from '@gs/shared/gpu/shape-distance.wgsl?raw';
import shaderCode from './shader.wgsl?raw';

export default shapeDistanceCode + '\n' + shaderCode;
