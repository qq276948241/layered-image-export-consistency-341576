import test from 'ava';
import mergeImages from '../src/index.js';
import { FakeCanvas, FakeImage, fakeImpl, decodeDataURI } from './helpers/fakes.js';
import * as px from './fixtures/pixels.js';

test.beforeEach(() => {
	FakeImage.reset();
	FakeImage.register('red2x2', px.red2x2);
	FakeImage.register('blueHalf2x2', px.blueHalfAlpha2x2);
	FakeImage.register('green1x1', px.green1x1);
	FakeImage.register('edge2x2', px.transparentEdge2x2);
	FakeImage.register('red1x1', { width: 1, height: 1, pixels: [255, 0, 0, 255] });
});

const merge = (sources, options = {}) => mergeImages(sources, { ...fakeImpl, ...options });

test.serial('transparent pixels are preserved', async t => {
	const b64 = await merge(['edge2x2']);
	const result = decodeDataURI(b64);
	t.is(result.format, 'image/png');
	t.is(result.width, 2);
	t.is(result.height, 2);
	t.deepEqual(Array.from(result.data), px.transparentEdge2x2.pixels);
});

test.serial('layers are drawn at non-zero positions', async t => {
	const b64 = await merge([{ src: 'green1x1', x: 1, y: 0 }], { width: 2, height: 1 });
	t.deepEqual(Array.from(decodeDataURI(b64).data), px.greenAt1x0.pixels);
});

test.serial('options.origin offsets every layer', async t => {
	const b64 = await merge(['green1x1'], { width: 2, height: 1, origin: { x: 1, y: 0 } });
	t.deepEqual(Array.from(decodeDataURI(b64).data), px.greenAt1x0.pixels);
});

test.serial('negative coordinates are clipped to the canvas bounds', async t => {
	const b64 = await merge([{ src: 'red2x2', x: -1, y: -1 }], { width: 2, height: 2 });
	t.deepEqual(Array.from(decodeDataURI(b64).data), px.red2x2ClippedToTopLeft.pixels);
});

test.serial('negative coordinates reject when options.clip is false', async t => {
	await t.throwsAsync(merge([{ src: 'red2x2', x: -1, y: 0 }], { width: 2, height: 2, clip: false }), {
		instanceOf: RangeError,
		message: /index 0/
	});
});

test.serial('half-alpha layers composite with premultiplied source-over semantics', async t => {
	const b64 = await merge(['red2x2', 'blueHalf2x2']);
	t.deepEqual(Array.from(decodeDataURI(b64).data), px.blueHalfOverRed2x2.pixels);
});

test.serial('load completion order does not change stacking order', async t => {
	FakeImage.manual = true;
	const promise = merge(['red2x2', 'blueHalf2x2']);
	// Complete the loads in the opposite order to the source array
	FakeImage.loadNext('blueHalf2x2');
	FakeImage.loadNext('red2x2');
	const b64 = await promise;
	// blueHalf2x2 is still stacked on top of red2x2
	t.deepEqual(Array.from(decodeDataURI(b64).data), px.blueHalfOverRed2x2.pixels);
});

test.serial('later layers in the source array are stacked on top', async t => {
	const b64 = await merge(['blueHalf2x2', 'red2x2']);
	t.deepEqual(Array.from(decodeDataURI(b64).data), px.red2x2.pixels);
});

test.serial('empty layer list resolves to an empty data URI', async t => {
	t.is(await merge([]), 'data:,');
});

test.serial('per-layer opacity is applied', async t => {
	const b64 = await merge([{ src: 'red1x1', opacity: 0.5 }]);
	t.deepEqual(Array.from(decodeDataURI(b64).data), px.redHalfAlpha1x1.pixels);
});

test.serial('options.alpha multiplies with per-layer opacity', async t => {
	const b64 = await merge([{ src: 'red1x1', opacity: 0.5 }], { alpha: 0.5 });
	t.deepEqual(Array.from(decodeDataURI(b64).data), px.redQuarterAlpha1x1.pixels);
});

test.serial('layers can be scaled with per-layer width and height', async t => {
	const b64 = await merge([{ src: 'green1x1', width: 2, height: 2 }]);
	const result = decodeDataURI(b64);
	t.is(result.width, 2);
	t.is(result.height, 2);
	t.deepEqual(Array.from(result.data), [0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255]);
});

test.serial('duplicate sources are drawn once per layer with independent Image instances', async t => {
	const b64 = await merge([
		{ src: 'red1x1', x: 0, y: 0 },
		{ src: 'red1x1', x: 1, y: 0 }
	], { width: 2, height: 1 });
	t.is(FakeImage.instances.length, 2);
	t.not(FakeImage.instances[0], FakeImage.instances[1]);
	t.deepEqual(Array.from(decodeDataURI(b64).data), [255, 0, 0, 255, 255, 0, 0, 255]);
});

test.serial('repeated calls with the same input produce the same output', async t => {
	const sources = ['red2x2', { src: 'blueHalf2x2', opacity: 0.7 }];
	const first = await merge(sources);
	const second = await merge(sources);
	t.is(first, second);
});

test.serial('format and quality are reflected in the output', async t => {
	const b64 = await merge(['red2x2'], { format: 'image/jpeg', quality: 0.5 });
	const result = decodeDataURI(b64);
	t.is(result.format, 'image/jpeg');
	t.is(result.quality, 0.5);
});

class SyncFailingCanvas extends FakeCanvas {
	constructor(...args) {
		super(...args);
		this.encodeError = new Error('encode failed');
	}
}

test.serial('synchronous encoder failures reject the promise', async t => {
	await t.throwsAsync(
		merge(['red2x2'], { Canvas: SyncFailingCanvas, format: 'image/png' }),
		{ message: 'encode failed' }
	);
});

test.serial('callback-style encoder failures reject the promise', async t => {
	await t.throwsAsync(
		merge(['red2x2'], { Canvas: SyncFailingCanvas, format: 'image/jpeg' }),
		{ message: 'encode failed' }
	);
});

test.serial('failed loads release listeners on every pending image', async t => {
	FakeImage.registerError('bad');
	FakeImage.manual = true;
	const promise = merge(['red2x2', 'bad']);
	await t.throwsAsync(promise, { message: 'Couldn\'t load image at index 1' });
	for (const img of FakeImage.instances) {
		t.is(img.onload, null);
		t.is(img.onerror, null);
	}
});
