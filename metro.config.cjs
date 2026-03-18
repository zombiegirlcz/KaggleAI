// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Reduce watched files to avoid ENOSPC
config.watchFolders = [__dirname];
config.resolver.blockList = [
  /\/node_modules\/.*/,
];

module.exports = config;