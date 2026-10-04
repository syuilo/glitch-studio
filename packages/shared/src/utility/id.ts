let counter = -1;

function getTime(time: number): string {
	return time.toString().padStart(16, '0');
}

function getNoise(): string {
	return Math.random().toString(36).slice(2, 10);
}

export function genId(): string {
	counter++;
	return getTime(Date.now()) + '_' + getNoise() + '_' + counter.toString();
}

export function prettyId(id: string): string {
	const parts = id.split('_');
	if (parts.length !== 3) return id;
	return '#' + parts[1].toUpperCase();
}
