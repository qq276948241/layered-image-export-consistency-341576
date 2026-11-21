import test from 'ava';
import { Canvas, Image } from 'canvas';
import mergeImages from '../src/index.js';
import { FakeCanvas, FakeImage, fakeImpl } from './helpers/fakes.js';
import { getImage } from './fixtures/index.js';

test.beforeEach(() => {
	FakeImage.reset();
	FakeImage.register('red1x1', { width: 1, height: 1, pixels: [255, 0, 0, 255] });
});

const merge = (sources, options = {}) => mergeImages(sources, { ...fakeImpl, ...options });

class BombCanvas extends FakeCanvas {
	constructor(...args) {
		super(...args);
		throw new Error('Canvas was created');
	}
}

test.serial('rejects if no canvas implementation is available', async t => {
	await t.throwsAsync(mergeImages([], {}));
});

test.serial('rejects if sources is not an array', async t => {
	await t.throwsAsync(merge('red1x1'), {
		instanceOf: TypeError,
		message: /array/
	});
});

test.serial('rejects if options is not an object', async t => {
	await t.throwsAsync(mergeImages([], 'image/png'), {
		instanceOf: TypeError,
		message: /Options must be an object/
	});
});

test.serial('rejects if a source is not a string or object', async t => {
	await t.throwsAsync(merge([42]), {
		instanceOf: TypeError,
		message: /index 0/
	});
});

test.serial('rejects if a source has no usable src', async t => {
	await t.throwsAsync(merge([{ src: '' }]), {
		instanceOf: TypeError,
		message: /index 0/
	});
	await t.throwsAsync(merge([{}]), {
		instanceOf: TypeError,
		message: /index 0/
	});
});

test.serial('rejects non-finite layer positions', async t => {
	await t.throwsAsync(merge([{ src: 'red1x1', x: Number.NaN }]), {
		instanceOf: TypeError,
		message: /x of source at index 0/
	});
	await t.throwsAsync(merge([{ src: 'red1x1', y: Number.POSITIVE_INFINITY }]), {
		instanceOf: TypeError,
		message: /y of source at index 0/
	});
	await t.throwsAsync(merge([{ src: 'red1x1', x: '4' }]), {
		instanceOf: TypeError,
		message: /x of source at index 0/
	});
});

test.serial('rejects invalid layer opacity', async t => {
	await t.throwsAsync(merge([{ src: 'red1x1', opacity: 'high' }]), {
		instanceOf: TypeError,
		message: /opacity of source at index 0/
	});
	await t.throwsAsync(merge([{ src: 'red1x1', opacity: 2 }]), {
		instanceOf: RangeError,
		message: /opacity of source at index 0/
	});
	await t.throwsAsync(merge([{ src: 'red1x1', opacity: -0.5 }]), {
		instanceOf: RangeError,
		message: /opacity of source at index 0/
	});
});

test.serial('rejects invalid layer scale dimensions', async t => {
	await t.throwsAsync(merge([{ src: 'red1x1', width: 0 }]), {
		instanceOf: RangeError,
		message: /width of source at index 0/
	});
	await t.throwsAsync(merge([{ src: 'red1x1', height: Number.NaN }]), {
		instanceOf: TypeError,
		message: /height of source at index 0/
	});
});

test.serial('rejects invalid output dimensions before creating the canvas', async t => {
	await t.throwsAsync(merge([], { width: 0, Canvas: BombCanvas }), {
		instanceOf: RangeError,
		message: /options\.width/
	});
	await t.throwsAsync(merge([], { height: -10, Canvas: BombCanvas }), {
		instanceOf: RangeError,
		message: /options\.height/
	});
	await t.throwsAsync(merge([], { width: Number.NaN, Canvas: BombCanvas }), {
		instanceOf: TypeError,
		message: /options\.width/
	});
	await t.throwsAsync(merge([], { height: Number.POSITIVE_INFINITY, Canvas: BombCanvas }), {
		instanceOf: TypeError,
		message: /options\.height/
	});
});

test.serial('rejects oversized canvases before creating the canvas', async t => {
	await t.throwsAsync(merge([], { width: 1e9, Canvas: BombCanvas }), {
		instanceOf: RangeError,
		message: /exceeds the maximum canvas size/
	});
	await t.throwsAsync(merge([], { width: 100, maxCanvasSize: 50, Canvas: BombCanvas }), {
		instanceOf: RangeError,
		message: /exceeds the maximum canvas size of 50/
	});
});

test.serial('rejects oversized computed dimensions before creating the canvas', async t => {
	FakeImage.register('huge', {
		width: 40000,
		height: 1,
		pixels: new Array(40000 * 4).fill(0)
	});
	await t.throwsAsync(merge(['huge'], { Canvas: BombCanvas }), {
		instanceOf: RangeError,
		message: /Computed canvas width/
	});
});

test.serial('rejects invalid quality, alpha and format', async t => {
	await t.throwsAsync(merge([], { quality: 1.5 }), {
		instanceOf: RangeError,
		message: /options\.quality/
	});
	await t.throwsAsync(merge([], { quality: Number.NaN }), {
		instanceOf: TypeError,
		message: /options\.quality/
	});
	await t.throwsAsync(merge([], { alpha: 2 }), {
		instanceOf: RangeError,
		message: /options\.alpha/
	});
	await t.throwsAsync(merge([], { format: 'text/plain' }), {
		instanceOf: TypeError,
		message: /options\.format/
	});
});

test.serial('rejects invalid origins', async t => {
	await t.throwsAsync(merge([], { origin: 5 }), {
		instanceOf: TypeError,
		message: /options\.origin/
	});
	await t.throwsAsync(merge([], { origin: { x: Number.NaN } }), {
		instanceOf: TypeError,
		message: /options\.origin\.x/
	});
});

test.serial('rejects layers overflowing the canvas when options.clip is false', async t => {
	await t.throwsAsync(merge([{ src: 'red1x1', x: 1, y: 0 }], { width: 1, height: 1, clip: false }), {
		instanceOf: RangeError,
		message: /index 0/
	});
});

test.serial('load failures reject with the source index', async t => {
	FakeImage.registerError('missing');
	await t.throwsAsync(merge(['red1x1', 'missing']), {
		message: 'Couldn\'t load image at index 1'
	});
	await t.throwsAsync(merge(['unregistered-src']), {
		message: 'Couldn\'t load image at index 0'
	});
});

test.serial('load failures reject with the source index on node-canvas', async t => {
	await t.throwsAsync(mergeImages(['nothing-here.jpg'], { Canvas, Image }), {
		message: 'Couldn\'t load image at index 0'
	});
});

class CallbackFailingCanvas extends Canvas {
	toDataURL(format, options, callback) {
		callback(new Error('node-canvas encode failed'));
	}
}

test.serial('node-canvas callback encoder errors reject the promise', async t => {
	const face = await getImage('face.png');
	await t.throwsAsync(
		mergeImages([face], { Canvas: CallbackFailingCanvas, Image, format: 'image/jpeg' }),
		{ message: 'node-canvas encode failed' }
	);
});
