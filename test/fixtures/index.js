import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

export const getImage = image => fs.readFile(path.join(dir, image));

export const getDataURI = async image => {
	const buffer = await getImage(image);
	const ext = path.extname(image).slice(1);
	const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
	return `data:${mime};base64,${buffer.toString('base64')}`;
};

export default { getImage, getDataURI };
