import * as fs from 'fs';

const env = fs.readFileSync('.env', 'utf-8');
const key = env.split('\n').find(line => line.startsWith('GEMINI_API_KEY='))?.split('=')[1]?.trim();

const model = 'gemini-2.5-flash-lite';
const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

// create 1x1 black png
const dummyImage = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const body = {
    contents: [{
        parts: [
            { text: "what is this?" },
            {
                inline_data: {
                    mime_type: "image/png",
                    data: dummyImage,
                },
            },
        ],
    }]
};

fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
})
.then(r => r.json())
.then(console.log)
.catch(console.error);
