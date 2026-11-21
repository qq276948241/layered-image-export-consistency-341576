import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'ava';
import { Canvas, Image, createCanvas, loadImage } from 'canvas';
import mergeImages from '../src/index.js';
import { getImage } from './fixtures/index.js';

const fixturePath = name => path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', name);

const pixelsOf = async src => {
	const img = await loadImage(src);
	const canvas = createCanvas(img.width, img.height);
	const ctx = canvas.getContext('2d');
	ctx.drawImage(img, 0, 0);
	return {
		width: img.width,
		height: img.height,
		data: ctx.getImageData(0, 0, img.width, img.height).data
	};
};

const pixelsOfFixture = name => pixelsOf(fixturePath(name));

const assertSamePixels = (t, actual, expected) => {
	t.is(actual.width, expected.width);
	t.is(actual.height, expected.height);
	const a = Buffer.from(actual.data);
	const b = Buffer.from(expected.data);
	if (!a.equals(b)) {
		const index = a.findIndex((value, i) => value !== b[i]);
		t.fail(`Pixels differ at byte ${index}: got ${a[index]}, expected ${b[index]}`);
		return;
	}

	t.pass();
};

const assertPixelsClose = (t, actual, expected, tolerance) => {
	t.is(actual.width, expected.width);
	t.is(actual.height, expected.height);
	let maxDiff = 0;
	for (let i = 0; i < actual.data.length; i++) {
		maxDiff = Math.max(maxDiff, Math.abs(actual.data[i] - expected.data[i]));
	}

	t.true(maxDiff <= tolerance, `Max channel difference ${maxDiff} exceeds tolerance ${tolerance}`);
};

test('returns an empty data URI if nothing is passed in', async t => {
	t.is(await mergeImages([], { Canvas, Image }), 'data:,');
});

test('returns a PNG data URI by default', async t => {
	const b64 = await mergeImages([await getImage('face.png')], { Canvas, Image });
	t.true(b64.startsWith('data:image/png;base64,'));
});

test('merges images pixel-perfectly', async t => {
	const images = await Promise.all(['body.png', 'mouth.png', 'eyes.png'].map(getImage));
	const b64 = await mergeImages(images, { Canvas, Image });
	assertSamePixels(t, await pixelsOf(b64), await pixelsOfFixture('face.png'));
});

test('uses custom dimensions', async t => {
	const b64 = await mergeImages([await getImage('face.png')], {
		width: 128,
		height: 128,
		Canvas,
		Image
	});
	assertSamePixels(t, await pixelsOf(b64), await pixelsOfFixture('face-custom-dimension.png'));
});

test('uses custom positions', async t => {
	const images = await Promise.all([
		{ src: 'body.png', x: 0, y: 0 },
		{ src: 'eyes.png', x: 32, y: 0 },
		{ src: 'mouth.png', x: 16, y: 0 }
	].map(async image => {
		image.src = await getImage(image.src);
		return image;
	}));
	const b64 = await mergeImages(images, { Canvas, Image });
	assertSamePixels(t, await pixelsOf(b64), await pixelsOfFixture('face-custom-positions.png'));
});

test('uses per-layer opacity', async t => {
	const images = await Promise.all([
		{ src: 'body.png' },
		{ src: 'eyes.png', opacity: 0.7 },
		{ src: 'mouth.png', opacity: 0.3 }
	].map(async image => {
		image.src = await getImage(image.src);
		return image;
	}));
	const b64 = await mergeImages(images, { Canvas, Image });
	assertSamePixels(t, await pixelsOf(b64), await pixelsOfFixture('face-opacity.png'));
});

test('applies a global alpha on top of per-layer opacity', async t => {
	const opaque = await mergeImages([await getImage('face.png')], { Canvas, Image });
	const faded = await mergeImages([await getImage('face.png')], { Canvas, Image, alpha: 0.5 });
	const opaquePixels = await pixelsOf(opaque);
	const fadedPixels = await pixelsOf(faded);
	t.is(fadedPixels.width, opaquePixels.width);
	// Every pixel should have roughly half the alpha of the opaque render
	let checked = 0;
	for (let i = 3; i < opaquePixels.data.length; i += 4) {
		if (opaquePixels.data[i] === 0) {
			continue;
		}

		checked++;
		t.true(Math.abs(fadedPixels.data[i] - Math.round(opaquePixels.data[i] * 0.5)) <= 1);
	}

	t.true(checked > 0);
});

test('encodes jpeg', async t => {
	const b64 = await mergeImages([await getImage('face.png')], {
		format: 'image/jpeg',
		Canvas,
		Image
	});
	t.true(b64.startsWith('data:image/jpeg;base64,'));
	const pixels = await pixelsOf(b64);
	const expected = await pixelsOfFixture('face.png');
	t.is(pixels.width, expected.width);
	t.is(pixels.height, expected.height);
});

test('uses custom jpeg quality', async t => {
	const image = await getImage('face.png');
	const low = await mergeImages([image], { format: 'image/jpeg', quality: 0.1, Canvas, Image });
	const high = await mergeImages([image], { format: 'image/jpeg', quality: 1, Canvas, Image });
	t.not(low, high);
	// The low quality render should still roughly match the reference fixture
	assertPixelsClose(t, await pixelsOf(low), await pixelsOfFixture('face-low-quality.jpeg'), 32);
});

test('scales layers with per-layer width and height', async t => {
	const b64 = await mergeImages([{ src: await getImage('face.png'), width: 64, height: 64 }], {
		width: 128,
		height: 128,
		Canvas,
		Image
	});
	const pixels = await pixelsOf(b64);
	t.is(pixels.width, 128);
	t.is(pixels.height, 128);
	// Outside the scaled 64x64 layer the canvas stays transparent
	t.is(pixels.data[((100 * 128) + 100) * 4 + 3], 0);
	// Inside the scaled layer there is visible content
	t.true(pixels.data[((32 * 128) + 32) * 4 + 3] > 0);
});

test('clips layers drawn at negative coordinates', async t => {
	const b64 = await mergeImages([{ src: await getImage('face.png'), x: -64, y: -64 }], {
		width: 128,
		height: 128,
		Canvas,
		Image
	});
	const pixels = await pixelsOf(b64);
	const expected = await pixelsOfFixture('face.png');
	// The visible top-left of the canvas is the face's (64, 64) pixel
	const actualOffset = 0;
	const expectedOffset = ((64 * 128) + 64) * 4;
	for (let c = 0; c < 4; c++) {
		t.is(pixels.data[actualOffset + c], expected.data[expectedOffset + c]);
	}
});

test('repeated calls with the same input produce the same output', async t => {
	const image = await getImage('face.png');
	const first = await mergeImages([image], { Canvas, Image });
	const second = await mergeImages([image], { Canvas, Image });
	t.is(first, second);
});
