const express = require("express");
const { generateWithFallback } = require("../utils/geminiHelper");
const NodeCache = require("node-cache");
const { protect } = require("../middlewares/authMiddleware");
const { aiLimiter, aiUserLimiter } = require("../middlewares/rateLimiter");

const questionCache = new NodeCache({
  stdTTL: 3600,
  maxKeys: 500,
});

const router = express.Router();
const MAX_RETRIES = 3;
const INITIAL_DELAY = 1000;


// GET /api/questions?topic=Probability
router.get("/", protect, aiLimiter, aiUserLimiter, async (req, res) => {
  const { topic } = req.query;

  if (typeof topic !== "string" || topic.trim().length === 0) {
    return res.status(400).json({ error: "Topic is required" });
  }

  const sanitizedTopic = topic.trim();

  if (sanitizedTopic.length > 100) {
    return res.status(400).json({ error: "Topic must be 100 characters or fewer" });
  }

  if (
    /[\p{Cc}\p{Zl}\p{Zp}<>]/u.test(sanitizedTopic) ||
    /[\p{P}\p{S}]{4,}/u.test(sanitizedTopic)
  ) {
    return res.status(400).json({ error: "Topic contains invalid characters" });
  }

  const normalizedTopic = sanitizedTopic.toLowerCase();
  const cacheKey = `questions:${normalizedTopic}`;

  const cachedQuestions = questionCache.get(cacheKey);

  if (cachedQuestions) {
    return res.json(cachedQuestions);
  }

  const prompt = `
    Generate 5 multiple-choice aptitude questions on the topic: ${sanitizedTopic}.
    Each question should have 4 options and indicate the correct answer in JSON format like:
    [
      {
        "question": "...",
        "options": ["A", "B", "C", "D"],
        "answer": "A"
      },
      ...
    ]
    Only return valid JSON, no extra text.
  `;

  try {
    // Use centralised helper with per-model retry (exponential backoff)
    const { result } = await generateWithFallback(
      process.env.GEMINI_API_KEY,
      [prompt],
      {},
      MAX_RETRIES,
      INITIAL_DELAY
    );

    const rawText = await result.response.text();
    let cleanedText = rawText
      .replace(/^\s*```json\s*/i, "")
      .replace(/^\s*```\s*/i, "")
      .replace(/(\s*```\s*)+$/i, "")
      .trim();
    let questions;
    try {
      questions = JSON.parse(cleanedText);
    } catch (err) {
      console.error("Gemini raw response:", rawText);
      console.error("Parse error:", err);
      return res
        .status(500)
        .json({
          error: "Failed to parse Gemini response",
        });
    }
    if (questionCache.has(cacheKey)) {
      return res.json(questionCache.get(cacheKey));
    }

    if (questionCache.keys().length >= 500) {
      questionCache.del(questionCache.keys()[0]);
    }

    questionCache.set(cacheKey, questions);

    return res.json(questions);
  } catch (error) {
    console.error("Gemini API error:", error);
    res
      .status(500)
      .json({ error: "Failed to generate questions" });
  }
});
module.exports = router;
