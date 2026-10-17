// The API compiles workspace TypeScript sources into its own CommonJS dist tree.
// TypeScript keeps package import names in emitted code, so resolve the runtime
// contract import to that compiled copy instead of the ESM TypeScript source.
const Module = require('node:module');
const path = require('node:path');

const compiledContracts = path.resolve(
  __dirname,
  '../dist/packages/contracts/src/index.js',
);
const resolveFilename = Module._resolveFilename;

Module._resolveFilename = function resolveCompiledWorkspacePackage(request, ...args) {
  return resolveFilename.call(
    this,
    request === '@kedaya/contracts' ? compiledContracts : request,
    ...args,
  );
};
