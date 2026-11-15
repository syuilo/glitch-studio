import shapeDistanceCode from '@gs/shared/gpu/shape-distance.wgsl?raw';
import shapeRendererCode from './shape-renderer.wgsl?raw';

export default shapeDistanceCode + '\n' + shapeRendererCode;
