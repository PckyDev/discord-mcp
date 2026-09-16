import { readFileSync, writeFileSync } from 'node:fs';
const source = new URL('../assets/audio-data.json', import.meta.url);
const data = JSON.parse(readFileSync(source, 'utf8'));
writeFileSync(new URL('../assets/audio-data.js', import.meta.url), `window.AUDIO_DATA=${JSON.stringify(data)};\n`);
console.log(`Embedded ${data.frames.length} audio frames.`);
