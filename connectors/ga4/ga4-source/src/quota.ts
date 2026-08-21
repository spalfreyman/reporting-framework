/**
 * A token-bucket limiter for the GA4 Data API.
 *
 * GA4 quotas are per-PROPERTY and shared by every consumer of that property, so a burst of
 * dashboard loads can exhaust the day for everyone. This caps the connector's own call rate
 * well below the property ceiling; when the bucket is empty a query serves cache (possibly
 * stale) rather than spending a token it does not have.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerHour: number,
    private readonly now: () => number = Date.now
  ) {
    this.tokens = capacity;
    this.lastRefill = now();
  }

  private refill(): void {
    const elapsedHours = (this.now() - this.lastRefill) / 3_600_000;
    if (elapsedHours <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedHours * this.refillPerHour);
    this.lastRefill = this.now();
  }

  /** Attempts to spend `cost` tokens; returns false if the bucket cannot cover it. */
  tryTake(cost = 1): boolean {
    this.refill();
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }

  get available(): number {
    this.refill();
    return Math.floor(this.tokens);
  }
}
