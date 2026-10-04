// A dependency uses this ES2022 helper. Supply it only when the host lacks it;
// syntax lowering alone does not add standard-library functions to Apps Script.
if (typeof Object.hasOwn !== 'function') {
  Object.defineProperty(Object, 'hasOwn', {
    configurable: true,
    writable: true,
    value: (object, key) => Object.prototype.hasOwnProperty.call(object, key),
  });
}
