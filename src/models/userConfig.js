/**
 * User configuration model.
 *
 * Allows end users to customize their live shopping experience:
 * - Product catalog (add/remove/edit products)
 * - Store name and branding
 * - Personality/greeting
 * - Showcase duration
 * - Theme colors
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CONFIG_DIR = join(homedir(), ".siro");
const CONFIG_PATH = join(CONFIG_DIR, "user-config.json");

const DEFAULTS = {
  storeName: "Siro Live Shop",
  greeting: "Hey! Welcome to the stream — what are you after today?",
  showcaseDuration: 12000,
  theme: {
    primary: "#d4af37",
    background: "#0a0a0a",
    text: "#ffffff",
  },
  products: [],
  prompts: {
    catalogImage: "Professional product photography, studio lighting, on a clean white background. Item: {productTitle}. Condition: {productCondition}.",
    showcaseScene: "Dynamic showcase shot of {productTitle} — {productDescription}. Professional lighting, product on rotating platform, commercial quality.",
    avatarPrompt: "3D avatar host for live shopping, friendly expression, professional studio lighting, holding {productTitle}.",
    noImageFallback: true,
  },
};

let config = { ...DEFAULTS };

try {
  const saved = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  config = { ...DEFAULTS, ...saved };
  console.log(`Loaded user config from ${CONFIG_PATH}`);
} catch {
  // First run — use defaults, will save when user configures
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
  } catch {}
}

function save() {
  try {
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (err) {
    console.warn("Could not save user config:", err.message);
  }
}

function getConfig() {
  return config;
}

function updateConfig(updates) {
  config = { ...config, ...updates };
  save();
  return config;
}

function addProduct(product) {
  const id = product.id || `prod-${Date.now()}`;
  const newProduct = {
    id,
    title: product.title || "Untitled Product",
    category: product.category || "general",
    description: product.description || "",
    price: Number(product.price) || 0,
    condition: product.condition || "New",
    images: product.images || [],
    cameraAngles: product.cameraAngles || ["front"],
    tags: product.tags || [],
    inStock: product.inStock !== false,
  };

  const existing = config.products.findIndex((p) => p.id === id);
  if (existing >= 0) {
    config.products[existing] = newProduct;
  } else {
    config.products.push(newProduct);
  }
  save();
  return newProduct;
}

function removeProduct(id) {
  const before = config.products.length;
  config.products = config.products.filter((p) => p.id !== id);
  if (config.products.length !== before) {
    save();
    return true;
  }
  return false;
}

function clearProducts() {
  config.products = [];
  save();
}

function hasUserProducts() {
  return config.products.length > 0;
}

function getPrompt(key) {
  const prompts = config.prompts || {};
  return prompts[key] || DEFAULTS.prompts[key];
}

function setPrompt(key, template) {
  if (!config.prompts) config.prompts = {};
  config.prompts[key] = template;
  save();
  return config.prompts[key];
}

function interpolatePrompt(template, product) {
  return template
    .replace(/{productTitle}/g, product?.title || "")
    .replace(/{productDescription}/g, product?.description || "")
    .replace(/{productCondition}/g, product?.condition || "")
    .replace(/{productPrice}/g, product?.price?.toString() || "")
    .replace(/{productCategory}/g, product?.category || "");
}

export function createUserConfig() {
  return {
    getConfig,
    updateConfig,
    addProduct,
    removeProduct,
    clearProducts,
    hasUserProducts,
    getPrompt,
    setPrompt,
    interpolatePrompt,
    configPath: CONFIG_PATH,
  };
}
