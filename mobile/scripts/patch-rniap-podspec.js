#!/usr/bin/env node
/**
 * React Native 0.86+ ships Folly inside ReactNativeDependencies and no longer
 * publishes a standalone `RCT-Folly` podspec, but react-native-iap@12's
 * RNIap.podspec still declares `s.dependency "RCT-Folly"`, which makes
 * `pod install` fail with:
 *   [!] Unable to find a specification for `RCT-Folly` depended upon by `RNIap`
 *
 * This script removes every `s.dependency 'RCT-Folly'` / `"RCT-Folly"` line
 * from node_modules/react-native-iap/RNIap.podspec. It is idempotent, and a
 * no-op (exit 0) when the package or the line is absent, so it is safe to run
 * from `postinstall` on any machine.
 */
const fs = require('fs');
const path = require('path');

const podspecPath = path.join(__dirname, '..', 'node_modules', 'react-native-iap', 'RNIap.podspec');

if (!fs.existsSync(podspecPath)) {
  console.log('[patch-rniap-podspec] RNIap.podspec not found; nothing to patch.');
  process.exit(0);
}

const original = fs.readFileSync(podspecPath, 'utf8');
const follyDependency = /^[ \t]*s\.dependency\s*\(?\s*(['"])RCT-Folly\1[^\n]*\r?\n?/gm;
const patched = original.replace(follyDependency, '');

if (patched === original) {
  console.log('[patch-rniap-podspec] No RCT-Folly dependency found; already patched.');
  process.exit(0);
}

fs.writeFileSync(podspecPath, patched);
console.log('[patch-rniap-podspec] Removed RCT-Folly dependency from RNIap.podspec.');
