
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Module = require("node:module");

const routePath = require.resolve("../routes/AptitudeQuestions");
const originalLoad = Module._load;
const cacheInstances = [];

class TestCache {
  constructor(options) {
    this.options = options;
    this.store = new Map();
    cacheInstances.push(this);
  }

  get(key) {
    return this.store.get(key);
  }

  has(key) {
    return this.store.has(key);
  }

  keys() {
    return [...this.store.keys()];
  }

  del(key) {
    return this.store.delete(key);
  }

  set(key, value) {
    if (
      !this.store.has(key) &&
      this.options.maxKeys !== undefined &&
      this.store.size >= this.options.maxKeys
    ) {
      throw new Error("Cache key limit exceeded");
    }

    this.store.set(key, value);
    return true;
  }
}

Module._load = function (request, parent, isMain) {
  if (parent?.filename === routePath && request === "node-cache") {
    return TestCache;
  }

  if (
    parent?.filename === routePath &&
    request === "../utils/geminiHelper"
  ) {
    return {
      generateWithFallback: async () => ({
        result: {
          response: {
            text: async () =>
              JSON.stringify([
                {
                  question: "Test question?",
                  options: ["A", "B", "C", "D"],
                  answer: "A",
                },
              ]),
          },
        },
      }),
    };
  }

  return originalLoad.call(this, request, parent, isMain);
};

let router;

try {
  delete require.cache[routePath];
  router = require("../routes/AptitudeQuestions");
} finally {
  Module._load = originalLoad;
}

const routeLayer = router.stack.find(
  (layer) =>
    layer.route &&
    layer.route.path === "/" &&
    layer.route.methods.get
);

const handler = routeLayer.route.stack.at(-1).handle;

function createRes() {
  return {
    statusCode: 200,
    body: null,

    status(code) {
      this.statusCode = code;
      return this;
    },

    json(body) {
      this.body = body;
      return this;
    },
  };
}

describe("Aptitude questions cache limit (#2375)", () => {
  it("keeps the cache within 500 entries after 501 unique topics", async () => {
    const cache = cacheInstances[0];

    expect(cache).toBeDefined();
    expect(cache.options.maxKeys).toBe(500);

    for (let i = 0; i < 501; i++) {
      const res = createRes();

      await handler({ query: { topic: `topic-${i}` } }, res);

      expect(res.statusCode).toBe(200);
    }

    expect(cache.keys()).toHaveLength(500);
    expect(cache.has("questions:topic-500")).toBe(true);
  });
});
