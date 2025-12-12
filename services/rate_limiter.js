// services/rate_limiter.js

/**
 * Simple token bucket rate limiter
 */
class RateLimiter {
  constructor(tokensPerSecond, maxTokens = null) {
    this.tokensPerSecond = tokensPerSecond;
    this.maxTokens = maxTokens || tokensPerSecond * 2;
    this.tokens = this.maxTokens;
    this.lastRefill = Date.now();
  }

  refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.tokensPerSecond);
    this.lastRefill = now;
  }

  async acquire(tokens = 1) {
    this.refill();

    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return;
    }

    // Wait for enough tokens
    const needed = tokens - this.tokens;
    const waitMs = (needed / this.tokensPerSecond) * 1000;
    await new Promise(resolve => setTimeout(resolve, waitMs));

    this.refill();
    this.tokens -= tokens;
  }
}

// Pre-configured limiters
const limiters = {
  serper: new RateLimiter(10, 20),    // 10 req/s, burst of 20
  google: new RateLimiter(0.5, 2),    // 1 req per 2s (conservative)
  deepseek: new RateLimiter(5, 10)    // 5 req/s
};

/**
 * Acquire a rate limit token before making a request
 */
async function acquireToken(service) {
  const limiter = limiters[service];
  if (limiter) {
    await limiter.acquire();
  }
}

module.exports = { RateLimiter, acquireToken, limiters };
