import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const scripts = [
  "data/01-gaoshu.js",
  "data/02-xiandai.js",
  "data/03-gailv.js",
  "data/04-wuli.js",
  "data/05-cailiao.js",
  "app.js",
];

let html = read("index.html");
const css = read("styles.css");

html = html.replace(
  '<link rel="stylesheet" href="styles.css">',
  () => `<style>\n${css}\n</style>`
);

for (const file of scripts) {
  const js = read(file).replace(/<\/script/gi, "<\\/script");
  html = html.replace(
    `<script src="${file}"></script>`,
    () => `<script>\n${js}\n</script>`
  );
}

html = html.replace(
  "<title>工科知识图谱 · 五门基础课交互思维导图</title>",
  "<title>工科知识图谱 · 高数 / 线代 / 概率 / 大物 / 材料</title>"
);

const out = path.join(root, "工科知识图谱.html");
fs.writeFileSync(out, html, "utf8");

const left = html.match(/(?:src|href)="(?!data:|#)[^"]+"/g) || [];
console.log(`wrote ${out}`);
console.log(`size ${(Buffer.byteLength(html, "utf8") / 1024).toFixed(1)} KB`);
console.log(left.length ? `external refs: ${left.join(", ")}` : "no external refs");
