// Defaults
const defaultOptions = {
	format: 'image/png',
	quality: 0.92,
	width: undefined,
	height: undefined,
	alpha: 1,
	origin: undefined,
	clip: true,
	maxCanvasSize: 32767,
	Canvas: undefined,
	Image: undefined,
	crossOrigin: undefined
};

const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value);

// node-canvas Image instances accept binary data (Buffer/Uint8Array) as src
const isBinarySource = value => typeof Uint8Array !== 'undefined' && value instanceof Uint8Array;

const isValidSrc = src =>
	(typeof src === 'string' && src.length > 0) || isBinarySource(src);

const validateFiniteNumber = (name, value) => {
	if (!isFiniteNumber(value)) {
		throw new TypeError(`${name} must be a finite number, got ${String(value)}`);
	}
};

const validateRatio = (name, value) => {
	validateFiniteNumber(name, value);
	if (value < 0 || value > 1) {
		throw new RangeError(`${name} must be between 0 and 1, got ${value}`);
	}
};

const validatePositiveDimension = (name, value) => {
	validateFiniteNumber(name, value);
	if (value <= 0) {
		throw new RangeError(`${name} must be greater than zero, got ${value}`);
	}
};

const validateCanvasDimension = (name, value, maxCanvasSize) => {
	validatePositiveDimension(name, value);
	if (value > maxCanvasSize) {
		throw new RangeError(`${name} of ${value} exceeds the maximum canvas size of ${maxCanvasSize}`);
	}
};

// Normalize a layer source. Strings are shorthand for `{ src }`, objects are
// validated field by field. Throws before any canvas is created.
const normalizeSource = (source, index) => {
	if (typeof source === 'string' || isBinarySource(source)) {
		source = { src: source };
	}

	if (source === null || typeof source !== 'object' || Array.isArray(source)) {
		throw new TypeError(`Source at index ${index} must be a string, binary data or an object`);
	}

	const layer = {
		src: source.src,
		x: source.x === undefined ? 0 : source.x,
		y: source.y === undefined ? 0 : source.y,
		opacity: source.opacity === undefined ? 1 : source.opacity,
		width: source.width,
		height: source.height
	};

	if (!isValidSrc(layer.src)) {
		throw new TypeError(`Source at index ${index} must have a valid src (non-empty string or binary data)`);
	}

	validateFiniteNumber(`x of source at index ${index}`, layer.x);
	validateFiniteNumber(`y of source at index ${index}`, layer.y);
	validateRatio(`opacity of source at index ${index}`, layer.opacity);

	if (layer.width !== undefined) {
		validatePositiveDimension(`width of source at index ${index}`, layer.width);
	}

	if (layer.height !== undefined) {
		validatePositiveDimension(`height of source at index ${index}`, layer.height);
	}

	return layer;
};

const normalizeOptions = options => {
	if (options === null || typeof options !== 'object' || Array.isArray(options)) {
		throw new TypeError('Options must be an object');
	}

	options = Object.assign({}, defaultOptions, options);

	if (typeof options.format !== 'string' || !options.format.startsWith('image/')) {
		throw new TypeError(`options.format must be an image MIME type, got ${String(options.format)}`);
	}

	validateRatio('options.quality', options.quality);
	validateRatio('options.alpha', options.alpha);
	validatePositiveDimension('options.maxCanvasSize', options.maxCanvasSize);

	if (options.width !== undefined) {
		validateCanvasDimension('options.width', options.width, options.maxCanvasSize);
	}

	if (options.height !== undefined) {
		validateCanvasDimension('options.height', options.height, options.maxCanvasSize);
	}

	if (options.origin === undefined) {
		options.origin = {};
	}

	if (options.origin === null || typeof options.origin !== 'object') {
		throw new TypeError('options.origin must be an object with x and y properties');
	}

	const origin = {
		x: options.origin.x === undefined ? 0 : options.origin.x,
		y: options.origin.y === undefined ? 0 : options.origin.y
	};
	validateFiniteNumber('options.origin.x', origin.x);
	validateFiniteNumber('options.origin.y', origin.y);
	options.origin = origin;

	options.clip = options.clip !== false;

	return options;
};

// Load a single layer into its own Image instance. Duplicate sources never
// share an Image, so no mutable Image state is shared between layers.
const loadImage = (Image, crossOrigin, layer, index, pending) => new Promise((resolve, reject) => {
	const img = new Image();
	pending.add(img);

	const cleanup = () => {
		img.onload = null;
		img.onerror = null;
		pending.delete(img);
	};

	img.onload = () => {
		cleanup();
		resolve(Object.assign({}, layer, { img }));
	};

	img.onerror = () => {
		cleanup();
		reject(new Error(`Couldn't load image at index ${index}`));
	};

	img.crossOrigin = crossOrigin;
	img.src = layer.src;
});

const loadImages = (Image, crossOrigin, layers) => {
	const pending = new Set();
	// Promise.all preserves the input order regardless of the order in which
	// the asynchronous loads complete, so stacking order is deterministic.
	const result = Promise.all(layers.map((layer, index) => loadImage(Image, crossOrigin, layer, index, pending)));
	// If any load fails, release the listeners of the images still in flight
	// so no callbacks fire after the returned promise has settled.
	result.catch(() => {
		pending.forEach(img => {
			img.onload = null;
			img.onerror = null;
		});
	});

	return result;
};

const getCanvasSize = (layers, options) => {
	// The default canvas size fits the widest/tallest layer, taking per-layer
	// scaling into account
	const width = options.width === undefined ?
		Math.max(0, ...layers.map(layer => layer.width === undefined ? layer.img.width : layer.width)) :
		options.width;
	const height = options.height === undefined ?
		Math.max(0, ...layers.map(layer => layer.height === undefined ? layer.img.height : layer.height)) :
		options.height;

	// An empty layer list legitimately produces a 0x0 canvas. Anything larger
	// must still fit within the maximum canvas size, checked before the
	// canvas is created.
	if (width > 0) {
		validateCanvasDimension('Computed canvas width', width, options.maxCanvasSize);
	}

	if (height > 0) {
		validateCanvasDimension('Computed canvas height', height, options.maxCanvasSize);
	}

	return { width, height };
};

const assertLayersFit = (layers, options, width, height) => {
	layers.forEach((layer, index) => {
		const layerWidth = layer.width === undefined ? layer.img.width : layer.width;
		const layerHeight = layer.height === undefined ? layer.img.height : layer.height;
		const x = layer.x + options.origin.x;
		const y = layer.y + options.origin.y;
		if (x < 0 || y < 0 || x + layerWidth > width || y + layerHeight > height) {
			throw new RangeError(`Layer at index ${index} overflows the canvas bounds and options.clip is false`);
		}
	});
};

const drawLayers = (ctx, layers, options) => {
	layers.forEach(layer => {
		// Global alpha and per-layer opacity combine multiplicatively. The
		// canvas composites with premultiplied source-over semantics, so
		// transparent edges blend consistently across layers.
		ctx.globalAlpha = options.alpha * layer.opacity;
		const x = layer.x + options.origin.x;
		const y = layer.y + options.origin.y;
		if (layer.width === undefined && layer.height === undefined) {
			ctx.drawImage(layer.img, x, y);
		} else {
			const width = layer.width === undefined ? layer.img.width : layer.width;
			const height = layer.height === undefined ? layer.img.height : layer.height;
			ctx.drawImage(layer.img, x, y, width, height);
		}
	});
	ctx.globalAlpha = 1;
};

// Unified result contract: every code path resolves to a base64 data URI
// string or rejects with the encoder's error.
const exportCanvas = (canvas, options) => {
	if (options.Canvas && options.format !== 'image/png') {
		// node-canvas encodes non-PNG formats asynchronously via a callback
		return new Promise((resolve, reject) => {
			canvas.toDataURL(options.format, {
				quality: options.quality,
				progressive: false
			}, (err, dataUri) => {
				if (err) {
					reject(err);
					return;
				}

				resolve(dataUri);
			});
		});
	}

	return Promise.resolve().then(() => canvas.toDataURL(options.format, options.quality));
};

// Return Promise
const mergeImages = (sources = [], options = {}) => new Promise((resolve, reject) => {
	let layers;
	try {
		if (!Array.isArray(sources)) {
			throw new TypeError('Sources must be an array');
		}

		options = normalizeOptions(options);
		layers = sources.map(normalizeSource);
	} catch (err) {
		reject(err);
		return;
	}

	resolve(loadImages(options.Image || window.Image, options.crossOrigin, layers)
		.then(layers => {
			const { width, height } = getCanvasSize(layers, options);
			if (!options.clip) {
				assertLayersFit(layers, options, width, height);
			}

			// The canvas is only created once every dimension has been validated
			const canvas = options.Canvas ?
				new options.Canvas(width, height) :
				window.document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;

			const ctx = canvas.getContext('2d');
			drawLayers(ctx, layers, options);

			return exportCanvas(canvas, options);
		}));
});

export default mergeImages;
