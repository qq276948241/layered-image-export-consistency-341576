// Controllable pure-JS Image/Canvas stand-ins for merge-images.
//
// FakeCanvas keeps a real RGBA pixel buffer and composites drawImage calls
// with premultiplied source-over semantics, so tests can assert on exact
// output pixels without a native canvas. FakeImage resolves loads from an
// in-memory registry, either automatically (microtask) or manually, so tests
// can control the order in which asynchronous loads complete.

const encodePixels = (format, quality, width, height, data) => {
	const payload = JSON.stringify({ width, height, quality, data: Array.from(data) });
	return `data:${format};base64,${Buffer.from(payload).toString('base64')}`;
};

export const decodeDataURI = uri => {
	if (uri === 'data:,') {
		return { format: '', width: 0, height: 0, quality: undefined, data: new Uint8ClampedArray(0) };
	}

	const match = /^data:([^;]+);base64,(.*)$/.exec(uri);
	if (!match) {
		throw new Error(`Not a base64 data URI: ${uri.slice(0, 64)}`);
	}

	const payload = JSON.parse(Buffer.from(match[2], 'base64').toString('utf8'));
	return {
		format: match[1],
		width: payload.width,
		height: payload.height,
		quality: payload.quality,
		data: Uint8ClampedArray.from(payload.data)
	};
};

class FakeContext {
	constructor(canvas) {
		this.canvas = canvas;
		this.globalAlpha = 1;
	}

	drawImage(img, dx, dy, dw, dh) {
		if (dw === undefined) {
			dw = img.width;
		}

		if (dh === undefined) {
			dh = img.height;
		}

		const { canvas } = this;
		const src = img.pixels;
		const dst = canvas.data;
		for (let y = 0; y < dh; y++) {
			const destY = Math.floor(dy + y);
			// Pixels outside the canvas bounds are clipped
			if (destY < 0 || destY >= canvas.height) {
				continue;
			}

			const srcY = Math.min(img.height - 1, Math.floor((y * img.height) / dh));
			for (let x = 0; x < dw; x++) {
				const destX = Math.floor(dx + x);
				if (destX < 0 || destX >= canvas.width) {
					continue;
				}

				const srcX = Math.min(img.width - 1, Math.floor((x * img.width) / dw));
				const si = ((srcY * img.width) + srcX) * 4;
				const di = ((destY * canvas.width) + destX) * 4;

				// Premultiplied source-over compositing
				const sa = (src[si + 3] / 255) * this.globalAlpha;
				const da = dst[di + 3] / 255;
				const outA = sa + (da * (1 - sa));
				for (let c = 0; c < 3; c++) {
					const sc = src[si + c] / 255;
					const dc = dst[di + c] / 255;
					const out = outA === 0 ? 0 : ((sc * sa) + (dc * da * (1 - sa))) / outA;
					dst[di + c] = Math.round(out * 255);
				}

				dst[di + 3] = Math.round(outA * 255);
			}
		}
	}

	getImageData(x, y, width, height) {
		const { canvas } = this;
		const data = new Uint8ClampedArray(width * height * 4);
		for (let row = 0; row < height; row++) {
			const srcY = y + row;
			if (srcY < 0 || srcY >= canvas.height) {
				continue;
			}

			for (let col = 0; col < width; col++) {
				const srcX = x + col;
				if (srcX < 0 || srcX >= canvas.width) {
					continue;
				}

				const si = ((srcY * canvas.width) + srcX) * 4;
				const di = ((row * width) + col) * 4;
				for (let c = 0; c < 4; c++) {
					data[di + c] = canvas.data[si + c];
				}
			}
		}

		return { data, width, height };
	}
}

export class FakeCanvas {
	constructor(width = 0, height = 0) {
		this._width = 0;
		this._height = 0;
		this.data = new Uint8ClampedArray(0);
		this.context = new FakeContext(this);
		// When set, toDataURL fails with this error on every code path
		this.encodeError = null;
		this.width = width;
		this.height = height;
	}

	get width() {
		return this._width;
	}

	set width(value) {
		this._width = value;
		this.resize();
	}

	get height() {
		return this._height;
	}

	set height(value) {
		this._height = value;
		this.resize();
	}

	resize() {
		this.data = new Uint8ClampedArray(this._width * this._height * 4);
	}

	getContext(type) {
		if (type !== '2d') {
			throw new Error(`FakeCanvas only supports 2d contexts, got ${type}`);
		}

		return this.context;
	}

	toDataURL(format = 'image/png', quality, callback) {
		if (typeof quality === 'object' && quality !== null) {
			// node-canvas style options argument
			quality = quality.quality;
		}

		const encode = () => {
			if (this.encodeError) {
				throw this.encodeError;
			}

			if (this._width === 0 || this._height === 0) {
				return 'data:,';
			}

			return encodePixels(format, quality, this._width, this._height, this.data);
		};

		if (typeof callback === 'function') {
			setImmediate(() => {
				try {
					callback(null, encode());
				} catch (err) {
					callback(err);
				}
			});
			return undefined;
		}

		return encode();
	}
}

export class FakeImage {
	constructor() {
		this.width = 0;
		this.height = 0;
		this.crossOrigin = null;
		this.onload = null;
		this.onerror = null;
		this.pixels = null;
		this._src = null;
		FakeImage.instances.push(this);
	}

	get src() {
		return this._src;
	}

	set src(value) {
		this._src = value;
		const record = FakeImage.registry.get(value);
		if (!record || record.error) {
			FakeImage.schedule(() => {
				if (this.onerror) {
					this.onerror(record ? record.error : new Error(`No fake image registered for ${value}`));
				}
			});
			return;
		}

		if (FakeImage.manual) {
			record.pending.push(this);
			return;
		}

		FakeImage.schedule(() => this.load(record));
	}

	load(record) {
		this.width = record.width;
		this.height = record.height;
		this.pixels = record.pixels;
		if (this.onload) {
			this.onload();
		}
	}

	static schedule(fn) {
		queueMicrotask(fn);
	}

	static reset() {
		FakeImage.registry = new Map();
		FakeImage.instances = [];
		FakeImage.manual = false;
	}

	static register(src, { width, height, pixels }) {
		FakeImage.registry.set(src, {
			width,
			height,
			pixels: Uint8ClampedArray.from(pixels),
			pending: []
		});
	}

	static registerError(src, error = new Error('Load failed')) {
		FakeImage.registry.set(src, { error, pending: [] });
	}

	// In manual mode, complete the next pending load for src
	static loadNext(src) {
		const record = FakeImage.registry.get(src);
		if (!record || record.pending.length === 0) {
			throw new Error(`No pending fake image for ${src}`);
		}

		record.pending.shift().load(record);
	}
}

FakeImage.reset();

export const fakeImpl = { Canvas: FakeCanvas, Image: FakeImage };
