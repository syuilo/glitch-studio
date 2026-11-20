// 近傍探索は全点を比較するため、描画解像度とは独立した仕事量の上限を持たせる。
// 相互近傍だけを採用すると、辺は最大N*K/2、三角形は最大N*K*(K-1)/6になる。
export const MAX_POINT_COUNT = 4096;
export const MAX_NEIGHBOR_COUNT = 12;
