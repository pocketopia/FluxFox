#!/usr/bin/env node
/**
 * React Native 0.86+ ships Folly inside ReactNativeDependencies and no longer
 * publishes a standalone `RCT-Folly` podspec, but react-native-iap@12's
 * RNIap.podspec still declares `s.dependency "RCT-Folly"`, which makes
 * `pod install` fail with:
 *   [!] Unable to find a specification for `RCT-Folly` depended upon by `RNIap`
 *
 * The same applies to the other legacy standalone pods the podspec declares
 * (RCTRequired, RCTTypeSafety, ReactCommon/turbomodule/core).
 *
 * This script removes every `s.dependency` line for those four pods from
 * node_modules/react-native-iap/RNIap.podspec, keeping `React-Core`. It is idempotent, and a
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

// Legacy standalone pods that no longer exist as separate podspecs on RN 0.86
// (React-Core-prebuilt + ReactNativeDependencies already provide them).
// `s.dependency "React-Core"` is intentionally NOT in this list.
const LEGACY_PODS = ['RCT-Folly', 'RCTRequired', 'RCTTypeSafety', 'ReactCommon/turbomodule/core'];

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');

const original = fs.readFileSync(podspecPath, 'utf8');
const legacyDependency = new RegExp(
  `^[ \\t]*s\\.dependency\\s*\\(?\\s*(['"])(?:${LEGACY_PODS.map(escapeRegExp).join('|')})\\1[^\\n]*\\r?\\n?`,
  'gm'
);
const patched = original.replace(legacyDependency, '');

if (patched === original) {
  console.log('[patch-rniap-podspec] No legacy pod dependencies found; already patched.');
  process.exit(0);
}

fs.writeFileSync(podspecPath, patched);
console.log(`[patch-rniap-podspec] Removed legacy pod dependencies (${LEGACY_PODS.join(', ')}) from RNIap.podspec.`);
