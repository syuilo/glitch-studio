// Click GradientとClick RippleのWGSLは、押下1件あたり最大9個の波源を受け取る。
export const MAX_CIRCULAR_BAND_PRESSES = 16;

export type CircularBandSource = { center: readonly [number, number]; radius: number; fade: number };

export function appendVisibleCircularBandSources(sources: CircularBandSource[], source: CircularBandSource,
	halfExtent: readonly [number, number], width: number, reflectivity: number) {
	const [centerX, centerY] = source.center;
	const [halfWidth, halfHeight] = halfExtent;
	// 描画領域外の押下を鏡写しにすると、帯が壁に届く前に領域内で反射が生まれてしまう。
	const reflects = reflectivity > 0 && Math.abs(centerX) <= halfWidth && Math.abs(centerY) <= halfHeight;
	const sourceXs = reflects ? [centerX, -2 * halfWidth - centerX, 2 * halfWidth - centerX] : [centerX];
	const sourceYs = reflects ? [centerY, -2 * halfHeight - centerY, 2 * halfHeight - centerY] : [centerY];
	const fadeByReflectionCount = [source.fade, source.fade * reflectivity, source.fade * reflectivity ** 2];
	const outerRadiusSquared = source.radius ** 2;
	const innerRadiusSquared = Math.max(0, source.radius - width) ** 2;
	for (const [yIndex, y] of sourceYs.entries()) {
		for (const [xIndex, x] of sourceXs.entries()) {
			// 円形の帯が矩形に届く波源だけを渡し、画素ごとに無関係な鏡像を評価するのを避ける。
			const distanceX = Math.abs(x);
			const distanceY = Math.abs(y);
			const nearestSquared = Math.max(0, distanceX - halfWidth) ** 2 + Math.max(0, distanceY - halfHeight) ** 2;
			const farthestSquared = (distanceX + halfWidth) ** 2 + (distanceY + halfHeight) ** 2;
			if (nearestSquared > outerRadiusSquared || farthestSquared < innerRadiusSquared) continue;
			const reflectionCount = Number(xIndex !== 0) + Number(yIndex !== 0);
			sources.push({ center: [x, y], radius: source.radius, fade: fadeByReflectionCount[reflectionCount] });
		}
	}
}
