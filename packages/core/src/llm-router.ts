export interface LLMEndpoint {
	url: string;
	apiKey?: string;
	weight: number;
	models?: string[];
}

export class WeightedRouter {
	private readonly endpoints: LLMEndpoint[];

	constructor(endpoints: LLMEndpoint[]) {
		this.endpoints = endpoints;
	}

	/** Select an endpoint using weighted random selection */
	select(model?: string): LLMEndpoint | undefined {
		let candidates = this.endpoints;
		if (model) {
			const modelFiltered = candidates.filter((e) => !e.models || e.models.includes(model));
			if (modelFiltered.length > 0) candidates = modelFiltered;
		}
		if (candidates.length === 0) return undefined;

		const totalWeight = candidates.reduce((sum, e) => sum + e.weight, 0);
		let random = Math.random() * totalWeight;
		for (const endpoint of candidates) {
			random -= endpoint.weight;
			if (random <= 0) return endpoint;
		}
		return candidates[candidates.length - 1];
	}
}
