(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DCImageResolver = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // The per-category artwork these paths point at was removed: it was generated,
  // not photographed, and a generated picture on a product card reads as a photo
  // of the item. Rows in older databases still carry the paths, so they are kept
  // here to be recognised and sent to the placeholder rather than 404.
  const RETIRED_CATEGORY_IMAGES = Object.freeze([
    'images/category-fallbacks/newborn.webp',
    'images/category-fallbacks/clothing.webp',
    'images/category-fallbacks/shoes.webp',
    'images/category-fallbacks/feeding.webp',
    'images/category-fallbacks/gear.webp',
    'images/category-fallbacks/bathcare.webp',
    'images/category-fallbacks/essentials.webp',
    'images/category-fallbacks/accessories.webp',
    'images/category-fallbacks/bedding.webp'
  ]);
  const PLACEHOLDER = 'images/placeholder.svg';

  function normalizePath(value) {
    return String(value || '').trim().replace(/\\/g, '/').toLowerCase().split(/[?#]/)[0];
  }

  function isCategoryImage(img) {
    const value = normalizePath(img);
    return RETIRED_CATEGORY_IMAGES.some((path) => normalizePath(path) === value);
  }

  // product_2.jpg is a shop flyer, not a garment; the rest are a logo card.
  function isKnownLogoPlaceholder(img) {
    const value = normalizePath(img);
    return /(^|\/)product_(?:1|2|5\d|6\d|7\d|8[0-3])\.jpg$/.test(value);
  }

  function isGenuineImage(img) {
    const value = normalizePath(img);
    if (!value) return false;
    return !isCategoryImage(value) &&
      !/(^|\/)placeholder\.(svg|png|jpe?g|webp)$/.test(value) &&
      !isKnownLogoPlaceholder(value);
  }

  function resolve(product) {
    const item = product || {};
    if (isGenuineImage(item.img)) return { src: item.img, isPlaceholder: false };
    return { src: PLACEHOLDER, isPlaceholder: true };
  }

  return { RETIRED_CATEGORY_IMAGES, PLACEHOLDER, normalizePath, isCategoryImage, isKnownLogoPlaceholder, isGenuineImage, resolve };
});
