#!/usr/bin/env node
'use strict';

// Atualiza hashes SHA-256 e URLs imutáveis dos módulos no manifesto.
// Uso local: node scripts/update-manifest.js [ref]
// No GitHub Actions, GITHUB_SHA é usado automaticamente.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, 'modules', 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const ref = process.argv[2]
  || process.env.GITHUB_SHA
  || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

if (!/^(feature\/modularizacao|[a-f0-9]{40})$/i.test(ref)) {
  throw new Error('Ref inválida. Informe a branch feature/modularizacao ou um SHA de commit de 40 caracteres.');
}
if (!Array.isArray(manifest.modules) || manifest.modules.length === 0) {
  throw new Error('O manifesto não contém módulos.');
}

for (const module of manifest.modules) {
  if (!/^[a-z][a-z0-9_-]{1,63}$/.test(module.id)) {
    throw new Error(`ID de módulo inválido: ${module.id}`);
  }

  const filePath = path.join(root, 'modules', `${module.id}.js`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Arquivo não encontrado para o módulo ${module.id}: ${filePath}`);
  }

  const bytes = fs.readFileSync(filePath);
  module.sha256 = crypto.createHash('sha256').update(bytes).digest('hex');

  const moduleUrl = new URL(module.url);
  moduleUrl.searchParams.set('ref', ref);
  module.url = moduleUrl.toString();

  console.log(`${module.id}: SHA-256 ${module.sha256}`);
  console.log(`  URL: ${module.url}`);
}

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log('Manifesto atualizado com sucesso.');
