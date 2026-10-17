/**
 * In-process token bucket. Each serverless instance keeps its own buckets, so this
 * is a best-effort guard; the authoritative limit belongs in a Vercel Firewall rule.
 */
interface Bucket {
  tokens: number;
  updatedAt: number;
}

export interface RateLimitPolicy {
  name: string;
  capacity: number;
  refillPerMinute: number;
}

export const CREATE_POLICY: RateLimitPolicy = { name: "create", capacity: 60, refillPerMinute: 60 };
export const READ_POLICY: RateLimitPolicy = { name: "read", capacity: 120, refillPerMinute: 120 };

const MAX_BUCKETS = 20_000;

export class TokenBucketLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly now: () => number = Date.now) {}

  take(policy: RateLimitPolicy, key: string): { allowed: boolean; retryAfterSeconds: number } {
    const id = `${policy.name}:${key}`;
    const t = this.now();
    const ratePerMs = policy.refillPerMinute / 60_000;
    const existing = this.buckets.get(id);
    const bucket: Bucket = existing ?? { tokens: policy.capacity, updatedAt: t };
    bucket.tokens = Math.min(policy.capacity, bucket.tokens + (t - bucket.updatedAt) * ratePerMs);
    bucket.updatedAt = t;

    if (!existing) {
      if (this.buckets.size >= MAX_BUCKETS) this.evictOldest();
      this.buckets.set(id, bucket);
    }
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, retryAfterSeconds: 0 };
    }
    return { allowed: false, retryAfterSeconds: Math.ceil((1 - bucket.tokens) / ratePerMs / 1000) };
  }

  private evictOldest(): void {
    const cutoff = Math.floor(MAX_BUCKETS / 10);
    let removed = 0;
    for (const key of this.buckets.keys()) {
      this.buckets.delete(key);
      if (++removed >= cutoff) break;
    }
  }
}

const globalForLimiter = globalThis as unknown as { __tabLimiter?: TokenBucketLimiter };
export const limiter = (globalForLimiter.__tabLimiter ??= new TokenBucketLimiter());

export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip") || "unknown";
}
