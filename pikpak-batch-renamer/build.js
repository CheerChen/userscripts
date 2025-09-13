#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

console.log('🔨 Building userscript...');

// Read version file
const versionPath = path.join(__dirname, 'VERSION');
if (!fs.existsSync(versionPath)) {
    console.error('❌ Version file not found:', versionPath);
    process.exit(1);
}

let currentVersion = fs.readFileSync(versionPath, 'utf8').trim();
console.log(`📋 Current version: ${currentVersion}`);

// Read core functions
const coreFunctionsPath = path.join(__dirname, 'src', 'core-functions.js');
if (!fs.existsSync(coreFunctionsPath)) {
    console.error('❌ Core functions file not found:', coreFunctionsPath);
    process.exit(1);
}

const coreFunctionsContent = fs.readFileSync(coreFunctionsPath, 'utf8');
console.log('✅ Core functions file loaded');

// Read template file
const templatePath = path.join(__dirname, 'template.js');
if (!fs.existsSync(templatePath)) {
    console.error('❌ Template file not found:', templatePath);
    process.exit(1);
}

const templateContent = fs.readFileSync(templatePath, 'utf8');
console.log('✅ Template file loaded');

// Process core functions: remove export statements and add proper indentation
const pureFunctions = coreFunctionsContent
    .replace(/export\s+function/g, 'function')
    .replace(/export\s+\{[^}]+\}/g, '')
    .split('\n')
    .map(line => line ? '    ' + line : line) // Add 4-space indentation
    .join('\n');

// Generate new content with current version (without incrementing yet)
const newContent = templateContent
    .replace('    // {{CORE_FUNCTIONS_PLACEHOLDER}}', pureFunctions)
    .replace('{{VERSION}}', currentVersion);

// Calculate content hash
const newContentHash = crypto.createHash('md5').update(newContent).digest('hex');

// Check if output file exists and compare
const distDir = path.join(__dirname, 'dist');
const outputPath = path.join(distDir, 'pikpak-batch-renamer.user.js');
let shouldIncrementVersion = true;

if (fs.existsSync(outputPath)) {
    const existingContent = fs.readFileSync(outputPath, 'utf8');
    const previousHash = crypto.createHash('md5').update(existingContent).digest('hex');
    
    if (newContentHash === previousHash) {
        shouldIncrementVersion = false;
        console.log('📊 No changes detected, version remains the same');
    } else {
        console.log('📊 Content changes detected, incrementing version');
    }
} else {
    console.log('📊 First build, creating initial version');
}

// Increment version if needed
let finalVersion = currentVersion;
if (shouldIncrementVersion) {
    const versionParts = currentVersion.split('.');
    const major = parseInt(versionParts[0]) || 0;
    const minor = parseInt(versionParts[1]) || 0;
    const patch = parseInt(versionParts[2]) || 0;

    finalVersion = `${major}.${minor}.${patch + 1}`;
    fs.writeFileSync(versionPath, finalVersion, 'utf8');
    console.log(`🚀 Version updated: ${currentVersion} → ${finalVersion}`);
}

// Generate final content with correct version
const finalContent = templateContent
    .replace('    // {{CORE_FUNCTIONS_PLACEHOLDER}}', pureFunctions)
    .replace('{{VERSION}}', finalVersion);

// Ensure dist directory exists
if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
    console.log('✅ Created dist directory');
}

// Write final file
fs.writeFileSync(outputPath, finalContent, 'utf8');

console.log('✅ Build completed!');
console.log(`📄 Output file: ${outputPath}`);
console.log('🚀 Ready to install in browser');

// Display file size
const stats = fs.statSync(outputPath);
const fileSizeKB = (stats.size / 1024).toFixed(2);
console.log(`📊 File size: ${fileSizeKB} KB`);
