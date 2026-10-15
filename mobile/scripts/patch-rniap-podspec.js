#!/usr/bin/env node
/**
 * React Native 0.86+ ships Folly inside ReactNativeDependencies and no longer
 * publishes standalone `RCT-Folly` / `RCTRequired` / `RCTTypeSafety` /
 * `ReactCommon/turbomodule/core` podspecs, but react-native-iap@12's
 * RNIap.podspec still declares them inside an
 * `if ENV['RCT_NEW_ARCH_ENABLED'] == '1' ... end` block, which makes
 * `pod install` fail with:
 *   [!] Unable to find a specification for `RCT-Folly` depended upon by `RNIap`
 *
 * This script (idempotent, safe to run from `postinstall` on any machine):
 *   1. strips the ENTIRE `if ENV['RCT_NEW_ARCH_ENABLED'] == '1' ... end` block,
 *   2. strips any remaining RCT-Folly / RCTRequired / RCTTypeSafety /
 *      ReactCommon dependency line anywhere in the file (`React-Core` is kept),
 *   3. prints the final RNIap.podspec to stdout so CI logs show the exact file
 *      CocoaPods reads.
 * It is a no-op (exit 0) when the package is absent.
 */
const fs = require('fs');
const path = require('path');

const podspecPath = path.join(__dirname, '..', 'node_modules', 'react-native-iap', 'RNIap.podspec');

if (!fs.existsSync(podspecPath)) {
  console.log('[patch-rniap-podspec] RNIap.podspec not found; nothing to patch.');
  process.exit(0);
}

const NEW_ARCH_IF = /^\s*if\s+ENV\[\s*['"]RCT_NEW_ARCH_ENABLED['"]\s*\]/;
const BLOCK_OPENER = /^\s*(?:if|unless|case|while|until|begin)\b|\bdo(?:\s*\|[^|]*\|)?\s*$/;
const BLOCK_END = /^\s*end\b/;
const NEW_ARCH_COMMENT = /^\s*#.*(?:old|new)\s+architecture/i;
const LEGACY_DEPENDENCY =
  /^\s*s\.dependency\s*\(?\s*['"](?:RCT-Folly|RCTRequired|RCTTypeSafety|ReactCommon)[^'"]*['"]/;

const original = fs.readFileSync(podspecPath, 'utf8');
const lines = original.split(/(?<=\n)/);
const kept = [];
let removedBlock = false;
let removedLines = 0;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  if (NEW_ARCH_IF.test(line)) {
    // Drop the explanatory comment directly above the block, if any.
    while (kept.length && NEW_ARCH_COMMENT.test(kept[kept.length - 1])) kept.pop();
    // Skip through the matching `end` (tracking nested blocks).
    let depth = 1;
    while (depth > 0 && ++i < lines.length) {
      if (BLOCK_END.test(lines[i])) depth--;
      else if (BLOCK_OPENER.test(lines[i])) depth++;
    }
    removedBlock = true;
    continue;
  }

  if (LEGACY_DEPENDENCY.test(line)) {
    removedLines++;
    continue;
  }

  kept.push(line);
}

const patched = kept.join('');

if (patched !== original) {
  fs.writeFileSync(podspecPath, patched);
  console.log(
    `[patch-rniap-podspec] Patched RNIap.podspec (removed RCT_NEW_ARCH_ENABLED block: ${removedBlock}, extra legacy dependency lines: ${removedLines}).`
  );
} else {
  console.log('[patch-rniap-podspec] RNIap.podspec already patched.');
}

console.log('[patch-rniap-podspec] ===== final RNIap.podspec =====');
console.log(fs.readFileSync(podspecPath, 'utf8'));
console.log('[patch-rniap-podspec] ===== end RNIap.podspec =====');
