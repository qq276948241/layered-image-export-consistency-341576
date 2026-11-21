// Offline pixel fixtures: tiny RGBA bitmaps defined inline so tests never
// touch the network or the filesystem. Expected composites are hand-computed
// with premultiplied source-over semantics (the same math the canvas
// spec mandates), independent of the implementation under test.

const solid = (width, height, rgba) => ({
	width,
	height,
	pixels: Array.from({ length: width * height }, () => rgba).flat()
});

export const red2x2 = solid(2, 2, [255, 0, 0, 255]);
export const blueHalfAlpha2x2 = solid(2, 2, [0, 0, 255, 128]);
export const green1x1 = solid(1, 1, [0, 255, 0, 255]);

// Left column opaque white, right column fully transparent
export const transparentEdge2x2 = {
	width: 2,
	height: 2,
	pixels: [
		255, 255, 255, 255, 0, 0, 0, 0,
		255, 255, 255, 255, 0, 0, 0, 0
	]
};

// Half-alpha blue (128/255) over opaque red:
// outA = 1, R = 255 * (1 - 128/255) = 127, B = 255 * (128/255) = 128
export const blueHalfOverRed2x2 = solid(2, 2, [127, 0, 128, 255]);

// Opaque red drawn with globalAlpha 0.5 onto a transparent canvas:
// outA = 0.5 -> alpha 128, color stays pure red
export const redHalfAlpha1x1 = { width: 1, height: 1, pixels: [255, 0, 0, 128] };

// Opaque red drawn with globalAlpha 0.25 (options.alpha 0.5 x layer opacity 0.5):
// outA = 0.25 -> alpha 64
export const redQuarterAlpha1x1 = { width: 1, height: 1, pixels: [255, 0, 0, 64] };

// red2x2 drawn at (-1, -1) on a 2x2 canvas: only the top-left pixel survives
// (it receives the source's bottom-right pixel)
export const red2x2ClippedToTopLeft = {
	width: 2,
	height: 2,
	pixels: [
		255, 0, 0, 255, 0, 0, 0, 0,
		0, 0, 0, 0, 0, 0, 0, 0
	]
};

// green1x1 drawn at (1, 0) on a 2x1 canvas
export const greenAt1x0 = {
	width: 2,
	height: 1,
	pixels: [0, 0, 0, 0, 0, 255, 0, 255]
};
