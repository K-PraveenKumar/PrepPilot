
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const router = require("../routes/AptitudeQuestions");
const { protect } = require("../middlewares/authMiddleware");
const { aiLimiter, aiUserLimiter } = require("../middlewares/rateLimiter");

const routeLayer = router.stack.find(
  (layer) =>
    layer.route &&
    layer.route.path === "/" &&
    layer.route.methods.get
);

const routeStack = routeLayer?.route.stack.map((layer) => layer.handle);

function createRes() {
  const res = {
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

  return res;
}

describe("Aptitude questions security (#2375)", () => {
  it("requires authentication and applies both AI rate limiters", () => {
    expect(routeStack).toBeDefined();
    expect(routeStack[0]).toBe(aiLimiter);
    expect(routeStack[1]).toBe(protect);
    expect(routeStack[2]).toBe(aiUserLimiter);
  });

  it("rejects a missing topic without calling the AI helper", async () => {
    const handler = routeStack.at(-1);
    const res = createRes();

    await handler({ query: {} }, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "Topic is required" });
  });

  it("rejects topics longer than 100 characters", async () => {
    const handler = routeStack.at(-1);
    const res = createRes();

    await handler(
      { query: { topic: "a".repeat(101) } },
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      error: "Topic must be 100 characters or fewer",
    });
  });

  it.each(["<script>", "probability>", "topic\u0001test"])(
    "rejects invalid topic characters in %j",
    async (topic) => {
      const handler = routeStack.at(-1);
      const res = createRes();

      await handler({ query: { topic } }, res);

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({
        error: "Topic contains invalid characters",
      });
    }
  );
});
