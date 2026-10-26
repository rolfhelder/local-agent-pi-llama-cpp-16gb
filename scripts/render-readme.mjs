// Deterministic, dependency-free README artwork. Metrics come from reviewed results.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const asset=path.join(root,'assets');await mkdir(asset,{recursive:true});
const frame=(height,description,body)=>`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}" viewBox="0 0 1200 ${height}" role="img" aria-labelledby="title desc"><title id="title">Local Agent: Pi + llama.cpp</title><desc id="desc">${description}</desc>${body}</svg>\n`;
const hero=frame(380,'Qwen3.8 27B IQ4_XS with Pi and llama.cpp. Measured 19 generation TPS at 88k input in a 96k slot on RTX 4090 Laptop, 16 GB VRAM and 32 GB RAM. Windows profile; optional Pi App.',`
<defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#102b35"/><stop offset="1" stop-color="#193d40"/></linearGradient><pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#d6e4df" opacity=".07"/></pattern></defs>
<rect width="1200" height="380" rx="22" fill="url(#bg)"/><rect width="1200" height="380" rx="22" fill="url(#dots)"/>
<g font-family="Segoe UI,Arial,sans-serif"><text x="48" y="52" fill="#9ee4c4" font-size="14" font-weight="700" letter-spacing="3">LOCAL AI · ONE MODEL · YOUR MACHINE</text>
<text x="46" y="125" fill="#f4f4e9" font-size="48" font-weight="700">Qwen3.8 27B</text><text x="49" y="169" fill="#c2d8d7" font-size="26">Pi harness + llama.cpp</text>
<text x="49" y="221" fill="#9ee4c4" font-size="24" font-weight="700">Q4 weights · 96k context · ~19 TPS</text><text x="49" y="250" fill="#a9c4c4" font-size="17">Measured CPU/GPU placement. Reasoning stays on.</text>
<rect x="650" y="58" width="502" height="222" rx="14" fill="#0a202a" stroke="#40615f"/><circle cx="673" cy="81" r="4" fill="#edb996"/><circle cx="689" cy="81" r="4" fill="#d8d28c"/><circle cx="705" cy="81" r="4" fill="#9ee4c4"/><text x="1128" y="85" text-anchor="end" fill="#8ba7a7" font-size="12">STARTUP EXAMPLE</text>
<g font-family="Consolas,monospace" font-size="19"><text x="675" y="132" fill="#9ee4c4">&gt; local-ai optimize qwen38</text><text x="675" y="170" fill="#dce7e3">&gt; local-ai</text><text x="675" y="202" fill="#8ba7a7">Pi CLI / optional Pi App</text><text x="675" y="238" fill="#dce7e3">llama.cpp → Qwen IQ4_XS</text></g>
<path d="M48 306H1152" stroke="#40615f"/><text x="49" y="344" fill="#e3ece5" font-size="17">WINDOWS</text><text x="217" y="344" fill="#a9c4c4" font-size="17">RTX 4090 Laptop</text><text x="505" y="344" fill="#9ee4c4" font-size="17" font-weight="700">16 GB VRAM</text><text x="750" y="344" fill="#a9c4c4" font-size="17">32 GB system RAM</text></g>`);
await writeFile(path.join(asset,'readme-hero.svg'),hero);
const data=JSON.parse(await readFile(path.join(root,'results/models.json'),'utf8'));
const labels={gemma:'Gemma 4 12B',qwen:'Qwen3.5 9B',omnicoder:'OmniCoder 9B','gpt-oss':'GPT-OSS 20B'};
let bars='';for(const [index,id]of ['gemma','qwen','omnicoder','gpt-oss'].entries()){
 const m=data.models.find(m=>m.id===id),y=133+index*66;
 bars+=`<text x="44" y="${y+15}" fill="#183c40" font-size="18" font-weight="600">${labels[id]}</text>`;
 for(const [row,score,color]of [[0,m.effortRound1,'#b5c3c5'],[1,m.effortRound2,'#267a69']]){const by=y+row*23;bars+=`<rect x="255" y="${by}" width="650" height="14" rx="4" fill="#e7ece7"/><rect x="255" y="${by}" width="${650*score/13}" height="14" rx="4" fill="${color}"/><text x="930" y="${by+12}" fill="#183c40" font-size="15">${score} / 13</text>`;}
}
await writeFile(path.join(asset,'effort-comparison.svg'),frame(440,'Native effort-command task: Gemma 2 then 6, Qwen 0 then 7, OmniCoder 0 then 0, GPT-OSS 2 then 2 out of 13. No model completed the feature.',`<rect width="1200" height="440" rx="18" fill="#fafbf9"/><g font-family="Segoe UI,Arial,sans-serif"><text x="44" y="43" fill="#183c40" font-size="27" font-weight="700">The hard part: build a native /effort command</text><text x="44" y="77" fill="#536d70" font-size="17">13 behavioral checks. One attempt, then one diagnostic follow-up.</text><rect x="800" y="34" width="13" height="13" rx="3" fill="#b5c3c5"/><text x="823" y="46" fill="#536d70" font-size="15">Round 1</text><rect x="960" y="34" width="13" height="13" rx="3" fill="#267a69"/><text x="983" y="46" fill="#536d70" font-size="15">Round 2</text>${bars}<text x="44" y="420" fill="#536d70" font-size="16">None completed all checks. Independent round scores; small exploratory sample.</text></g>`));
const measured=JSON.parse(await readFile(path.join(root,'evaluation/QWEN38-PERFORMANCE-2026-10-24.json'),'utf8'));
const find=id=>measured.trials.find(t=>t.id===id).medianGenerationTps;
const median=values=>values.toSorted((a,b)=>a-b)[Math.floor(values.length/2)];
const rows=[['7,866 input tokens',find('final-96k-largest3-8k-t24')],['49,674 input tokens',find('final-96k-largest3-50k-t24')],['88,146 input tokens',find('long-96k-largest3-ub64-t24')],['88,146 + Pi App',median(measured.piApp.runs.flatMap(r=>r.generation.map(g=>g.tps)))]];
let speedBars='';for(const [i,[label,tps]] of rows.entries()){
 const y=113+i*55;speedBars+=`<text x="44" y="${y+19}" fill="#183c40" font-size="19">${label}</text><rect x="300" y="${y}" width="650" height="26" rx="5" fill="#e7eeec"/><rect x="300" y="${y}" width="${(650*tps/26).toFixed(2)}" height="26" rx="5" fill="${i===3?'#176e72':'#328b7a'}"/><text x="975" y="${y+20}" fill="#183c40" font-size="21" font-weight="700">${tps.toFixed(2)} TPS</text>`;
}
const target=300+650*15/26;
await writeFile(path.join(asset,'qwen-performance.svg'),frame(380,'Qwen3.8 27B generation medians, three repetitions each: 23.92 TPS at7866 input,21.17 at49674,19.08 at88146,19.01 with Pi App. Fixed98304 context slot, same Q4 weights and enabled reasoning.',`<rect width="1200" height="380" rx="18" fill="#fafbf9"/><g font-family="Segoe UI,Arial,sans-serif"><text x="44" y="41" fill="#183c40" font-size="28" font-weight="700">Qwen3.8 27B · speed as context fills</text><text x="44" y="71" fill="#536d70" font-size="17">Fixed 96k slot · unchanged IQ4_XS · reasoning on · three repeats</text>${speedBars}<path d="M${target} 103V315" stroke="#173c48" stroke-width="2" stroke-dasharray="5 5"/><text x="${target+8}" y="99" fill="#173c48" font-size="14">15 TPS target</text><text x="44" y="354" fill="#536d70" font-size="16">Generation includes thinking. Cold 88k prompt ingestion still takes about three minutes.</text></g>`));
console.log('Generated README hero, Qwen speed graph and historical effort graph.');
