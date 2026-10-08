import * as fs from 'fs';

const env = fs.readFileSync('.env', 'utf-8');
const key = env.split('\n').find(line => line.startsWith('GEMINI_API_KEY='))?.split('=')[1]?.trim();

fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`)
  .then(res => res.json())
  .then(data => {
    const models = data.models.map((m: { name: string }) => m.name);
    console.log(models);
  })
  .catch(console.error);
