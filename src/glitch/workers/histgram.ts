const ctx: Worker = self as any;

class Histogram {
	constructor(imageData, type) {
		this.width = imageData.width;
		this.height = imageData.height;
		this.data = imageData.data;
		this.bins = {v1:[], v2:[], v3:[]};
		this.type = type || 'rgb';
		this.fillBins(256, 0);
	}

	fillBins(length, value) {
		for(var i=0; i<length; i++) {
			this.bins.v1[i] = value;
			this.bins.v2[i] = value;
			this.bins.v3[i] = value;
		}
	}

	calculate() {
		this.convertColor(this.type);
		var len = this.data.length;
		for(var i=0; i<len; i+=4) {
			this.bins.v1[this.data[i]]++;
			this.bins.v2[this.data[i + 1]]++;
			this.bins.v3[this.data[i + 2]]++;
		}
	}

	getMax() {
		var max = 0;
		for(var ch in this.bins) {
			for(var i=0; i<256; i++) {
				max = this.bins[ch][i] > max ? this.bins[ch][i] : max;
			}
		}
		return max;
	}

	normalize(factor) {
		for(var ch in this.bins) {
			for(var i=0; i<256; i++) {
				this.bins[ch][i] /= factor;
			}
		}
	}

	backProject() {
		// TODO
	}

	compare(hist, method) {
		// TODO
		switch(method) {
		case 'correl':
			break;
		case 'chisqr':
			break;
		case 'intersect':
			break;
		case 'bhattacharyya':
			break;
		default:
			break;
		}
	}

	convertColor(type) {
		// TODO
		switch(type) {
		case 'rgb':
			break;
		case 'gray':
			break;
		case 'hsv':
			break;
		default:
			break;
		}
	}
}

ctx.addEventListener('message', e => {
	const data = e.data;

	const histogram = new Histogram(data);
	histogram.calculate();
	histogram.bins.max = histogram.getMax();

	ctx.postMessage(histogram.bins);
}, false);

ctx.addEventListener('error', e => {
	ctx.postMessage(e);
}, false);
