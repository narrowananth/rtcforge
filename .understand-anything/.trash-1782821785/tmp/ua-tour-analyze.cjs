#!/usr/bin/env node
'use strict';
const fs = require('fs');

function main() {
  const inPath = process.argv[2];
  const outPath = process.argv[3];
  if (!inPath || !outPath) {
    console.error('Usage: node ua-tour-analyze.js <input.json> <output.json>');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const nodes = data.nodes || [];
  const edges = data.edges || [];
  const layers = data.layers || [];

  const nodeById = new Map();
  for (const n of nodes) nodeById.set(n.id, n);

  // Only consider edges whose endpoints are real graph nodes (skip class:/function: sub-nodes
  // not present in nodes list — but include them in counts if they exist as nodes).
  const isNode = (id) => nodeById.has(id);

  // Fan-in / fan-out over node-level endpoints only.
  const fanIn = new Map();
  const fanOut = new Map();
  for (const n of nodes) { fanIn.set(n.id, 0); fanOut.set(n.id, 0); }
  for (const e of edges) {
    if (isNode(e.source) && fanOut.has(e.source)) fanOut.set(e.source, fanOut.get(e.source) + 1);
    if (isNode(e.target) && fanIn.has(e.target)) fanIn.set(e.target, fanIn.get(e.target) + 1);
  }

  const nameOf = (id) => (nodeById.get(id) || {}).name || id;
  const summaryOf = (id) => (nodeById.get(id) || {}).summary || '';

  const fanInRanking = [...fanIn.entries()]
    .map(([id, v]) => ({ id, fanIn: v, name: nameOf(id) }))
    .sort((a, b) => b.fanIn - a.fanIn)
    .slice(0, 20);

  const fanOutRanking = [...fanOut.entries()]
    .map(([id, v]) => ({ id, fanOut: v, name: nameOf(id) }))
    .sort((a, b) => b.fanOut - a.fanOut)
    .slice(0, 20);

  // Entry point scoring
  const codeEntryNames = new Set(['index.ts','index.js','main.ts','main.js','app.ts','app.js','server.ts','server.js','mod.rs','main.go','main.py','main.rs','manage.py','app.py','wsgi.py','asgi.py','run.py','__main__.py','Application.java','Main.java','Program.cs','config.ru','index.php','App.swift','Application.kt','main.cpp','main.c']);

  const fanOutVals = [...fanOut.values()].sort((a,b)=>b-a);
  const top10pctIdx = Math.max(0, Math.floor(fanOutVals.length * 0.1) - 1);
  const fanOutTop10Threshold = fanOutVals.length ? fanOutVals[top10pctIdx] : 0;
  const fanInVals = [...fanIn.values()].sort((a,b)=>a-b);
  const bottom25Idx = Math.max(0, Math.floor(fanInVals.length * 0.25) - 1);
  const fanInBottom25Threshold = fanInVals.length ? fanInVals[bottom25Idx] : 0;

  const entryScores = [];
  for (const n of nodes) {
    let score = 0;
    const fp = n.filePath || '';
    const segs = fp.split('/');
    if (n.type === 'document') {
      if (n.name === 'README.md' && segs.length === 1) score += 5;
      else if (/\.md$/i.test(n.name) && segs.length === 1) score += 2;
    } else {
      if (codeEntryNames.has(n.name)) score += 3;
      // root or one-level deep relative to a package src is hard to define for monorepo;
      // approximate "shallow": filename right under a src/ dir or repo root.
      if (segs.length <= 2 || /\/src\/[^/]+$/.test(fp)) score += 1;
      if ((fanOut.get(n.id) || 0) >= fanOutTop10Threshold && fanOutTop10Threshold > 0) score += 1;
      if ((fanIn.get(n.id) || 0) <= fanInBottom25Threshold) score += 1;
    }
    if (score > 0) entryScores.push({ id: n.id, score, name: n.name, summary: n.summary || '' });
  }
  entryScores.sort((a, b) => b.score - a.score);
  const entryPointCandidates = entryScores.slice(0, 5);

  // BFS from top code entry point (skip documents)
  const isDoc = (id) => (nodeById.get(id) || {}).type === 'document';
  let startNode = null;
  for (const c of entryScores) { if (!isDoc(c.id)) { startNode = c.id; break; } }
  if (!startNode && nodes.length) startNode = nodes[0].id;

  // adjacency for imports + calls forward
  const adj = new Map();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    if ((e.type === 'imports' || e.type === 'calls') && isNode(e.source) && isNode(e.target)) {
      adj.get(e.source).push(e.target);
    }
  }
  const order = [];
  const depthMap = {};
  if (startNode) {
    const q = [startNode];
    depthMap[startNode] = 0;
    const seen = new Set([startNode]);
    while (q.length) {
      const cur = q.shift();
      order.push(cur);
      for (const nb of (adj.get(cur) || [])) {
        if (!seen.has(nb)) {
          seen.add(nb);
          depthMap[nb] = depthMap[cur] + 1;
          q.push(nb);
        }
      }
    }
  }
  const byDepth = {};
  for (const [id, d] of Object.entries(depthMap)) {
    (byDepth[d] = byDepth[d] || []).push(id);
  }

  // Non-code inventory
  const nonCodeFiles = { documentation: [], infrastructure: [], data: [], config: [] };
  for (const n of nodes) {
    const rec = { id: n.id, name: n.name, type: n.type, summary: n.summary || '' };
    switch (n.type) {
      case 'document': nonCodeFiles.documentation.push(rec); break;
      case 'service': case 'pipeline': case 'resource': nonCodeFiles.infrastructure.push(rec); break;
      case 'table': case 'schema': case 'endpoint': nonCodeFiles.data.push(rec); break;
      case 'config': nonCodeFiles.config.push(rec); break;
      default: break;
    }
  }

  // Clusters: bidirectional import/call pairs, expanded
  const directed = new Map();
  for (const e of edges) {
    if ((e.type === 'imports' || e.type === 'calls') && isNode(e.source) && isNode(e.target)) {
      directed.set(e.source + '||' + e.target, true);
    }
  }
  // edge count between unordered pairs (any imports/calls direction)
  const pairCount = new Map();
  for (const key of directed.keys()) {
    const [s, t] = key.split('||');
    const k = [s, t].sort().join('||');
    pairCount.set(k, (pairCount.get(k) || 0) + 1);
  }
  const clusterSeeds = [];
  for (const [k, c] of pairCount.entries()) {
    const [a, b] = k.split('||');
    if (directed.has(a + '||' + b) && directed.has(b + '||' + a)) {
      clusterSeeds.push({ nodes: [a, b], edgeCount: c });
    }
  }
  // If few bidirectional, fall back to strongest pairs by combined import count
  if (clusterSeeds.length < 3) {
    const sorted = [...pairCount.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10);
    for (const [k, c] of sorted) {
      const [a, b] = k.split('||');
      if (!clusterSeeds.some(cs => cs.nodes.includes(a) && cs.nodes.includes(b))) {
        clusterSeeds.push({ nodes: [a, b], edgeCount: c });
      }
    }
  }
  const clusters = clusterSeeds.slice(0, 10);

  // node summary index
  const nodeSummaryIndex = {};
  for (const n of nodes) {
    nodeSummaryIndex[n.id] = { name: n.name, type: n.type, summary: n.summary || '' };
  }

  const out = {
    scriptCompleted: true,
    entryPointCandidates,
    fanInRanking,
    fanOutRanking,
    bfsTraversal: { startNode, order, depthMap, byDepth },
    nonCodeFiles,
    clusters,
    layers: { count: layers.length, list: layers.map(l => ({ id: l.id, name: l.name, description: l.description })) },
    nodeSummaryIndex,
    totalNodes: nodes.length,
    totalEdges: edges.length
  };
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  process.exit(0);
}

try { main(); } catch (e) { console.error(e && e.stack ? e.stack : String(e)); process.exit(1); }
