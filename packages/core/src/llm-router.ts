export interface LLMEndpoint {
	url: string;
	apiKey?: string;
	weight: number;
	models?: string[];
}

export interface EndpointHealth {
	latencyEma: number;
	consecutiveFailures: number;
	healthy: boolean;
	lastFailureAt?: number;
	lastProbeAt?: number;
	requestCount: number;
}

export interface WeightedRouterOpts {
	alpha?: number;
	probeIntervalMs?: number;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function defaultHealth(): EndpointHealth {
	return {
		latencyEma: 0,
		consecutiveFailures: 0,
		healthy: true,
		requestCount: 0,
	};
}

export class WeightedRouter {
	private readonly endpoints: LLMEndpoint[];
	private readonly health: Map<string, EndpointHealth> = new Map();
	private readonly alpha: number;
	private readonly probeIntervalMs: number;

	constructor(endpoints: LLMEndpoint[], opts?: WeightedRouterOpts) {
		this.endpoints = endpoints;
		this.alpha = opts?.alpha ?? 0.3;
		this.probeIntervalMs = opts?.probeIntervalMs ?? 30_000;
	}

	private ensureHealth(endpointUrl: string): EndpointHealth {
		let h = this.health.get(endpointUrl);
		if (!h) {
			h = defaultHealth();
			this.health.set(endpointUrl, h);
		}
		return h;
	}

	recordLatency(endpointUrl: string, latencyMs: number): void {
		const h = this.ensureHealth(endpointUrl);
		h.requestCount++;
		if (h.latencyEma === 0) {
			h.latencyEma = latencyMs;
		} else {
			h.latencyEma = this.alpha * latencyMs + (1 - this.alpha) * h.latencyEma;
		}
		h.consecutiveFailures = 0;
		h.healthy = true;
	}

	recordFailure(endpointUrl: string): void {
		const h = this.ensureHealth(endpointUrl);
		h.consecutiveFailures++;
		if (h.consecutiveFailures >= 3) {
			h.healthy = false;
			h.lastFailureAt = Date.now();
		}
	}

	recordSuccess(endpointUrl: string): void {
		const h = this.ensureHealth(endpointUrl);
		h.consecutiveFailures = 0;
		h.healthy = true;
	}

	getHealth(endpointUrl: string): EndpointHealth | undefined {
		return this.health.get(endpointUrl);
	}

	getAllHealth(): Map<string, EndpointHealth> {
		return new Map(this.health);
	}

	/** Select an endpoint using weighted random selection with latency-adaptive routing */
	select(model?: string): LLMEndpoint | undefined {
		let candidates = this.endpoints;
		if (model) {
			const modelFiltered = candidates.filter((e) => !e.models || e.models.includes(model));
			if (modelFiltered.length > 0) candidates = modelFiltered;
		}
		if (candidates.length === 0) return undefined;

		// If no health data exists at all, use original static logic
		if (this.health.size === 0) {
			return this.selectByWeights(candidates, candidates.map((e) => e.weight));
		}

		const now = Date.now();

		// Compute average EMA across healthy endpoints with data
		let emaSum = 0;
		let emaCount = 0;
		for (const ep of candidates) {
			const h = this.health.get(ep.url);
			if (h && h.healthy && h.latencyEma > 0) {
				emaSum += h.latencyEma;
				emaCount++;
			}
		}
		const avgEma = emaCount > 0 ? emaSum / emaCount : 0;

		const adjustedWeights: number[] = [];
		for (const ep of candidates) {
			const h = this.health.get(ep.url);

			if (!h) {
				// No health data for this endpoint — use base weight
				adjustedWeights.push(ep.weight);
				continue;
			}

			if (!h.healthy) {
				const timeSinceProbe = h.lastProbeAt ? now - h.lastProbeAt : Infinity;
				if (timeSinceProbe > this.probeIntervalMs) {
					// Due for probe
					h.lastProbeAt = now;
					adjustedWeights.push(ep.weight * 0.1);
				} else {
					// Skip
					adjustedWeights.push(0);
				}
				continue;
			}

			if (h.latencyEma === 0) {
				// No latency data yet — use base weight
				adjustedWeights.push(ep.weight);
				continue;
			}

			if (avgEma === 0) {
				// Shouldn't happen if this endpoint has data and is healthy, but guard
				adjustedWeights.push(ep.weight);
				continue;
			}

			const factor = clamp(avgEma / h.latencyEma, 0.5, 2.0);
			adjustedWeights.push(ep.weight * factor);
		}

		return this.selectByWeights(candidates, adjustedWeights);
	}

	private selectByWeights(candidates: LLMEndpoint[], weights: number[]): LLMEndpoint | undefined {
		const totalWeight = weights.reduce((sum, w) => sum + w, 0);
		if (totalWeight <= 0) return undefined;

		let random = Math.random() * totalWeight;
		for (let i = 0; i < candidates.length; i++) {
			random -= weights[i];
			if (random <= 0) return candidates[i];
		}
		return candidates[candidates.length - 1];
	}
}
