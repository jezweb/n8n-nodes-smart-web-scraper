import {
	IExecuteFunctions,
	INodeType,
	INodeTypeDescription,
	IDataObject,
	INodeExecutionData,
	IHttpRequestOptions,
	NodeOperationError,
	NodeConnectionType,
} from 'n8n-workflow';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import axios, { AxiosProxyConfig } from 'axios';

// Helper functions
function getScrapingOrder(strategy: string, failoverOptions: IDataObject): string[] {
	const methods: string[] = [];

	switch (strategy) {
		case 'cost_effective':
			methods.push('http');
			if (failoverOptions.enableJina) methods.push('jina');
			if (failoverOptions.enableFirecrawl) methods.push('firecrawl');
			break;
		case 'speed_first':
			methods.push('http');
			if (failoverOptions.enableFirecrawl) methods.push('firecrawl');
			if (failoverOptions.enableJina) methods.push('jina');
			break;
		case 'quality_first':
			if (failoverOptions.enableFirecrawl) methods.push('firecrawl');
			if (failoverOptions.enableJina) methods.push('jina');
			methods.push('http');
			break;
		default:
			methods.push('http');
			if (failoverOptions.enableJina) methods.push('jina');
			if (failoverOptions.enableFirecrawl) methods.push('firecrawl');
	}

	return methods;
}

async function scrapeWithHttp(
	this: IExecuteFunctions,
	url: string,
	advancedOptions: IDataObject,
	outputOptions: IDataObject,
	failoverOptions: IDataObject,
): Promise<IDataObject> {
	const timeout = (advancedOptions.timeout as number) || 30000;
	const userAgent = (advancedOptions.userAgent as string) || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
	const customHeaders = advancedOptions.headers ? JSON.parse(advancedOptions.headers as string) : {};

	// Configure proxy if enabled
	let proxyConfig: AxiosProxyConfig | undefined;
	if (failoverOptions.enableProxy && failoverOptions.proxyHost) {
		proxyConfig = {
			host: failoverOptions.proxyHost as string,
			port: (failoverOptions.proxyPort as number) || 8080,
			protocol: (failoverOptions.proxyProtocol as string) || 'http',
		};
		if (failoverOptions.proxyUsername) {
			proxyConfig.auth = {
				username: failoverOptions.proxyUsername as string,
				password: failoverOptions.proxyPassword as string,
			};
		}
	}

	// Make HTTP request
	const response = await axios.get(url, {
		timeout,
		headers: {
			'User-Agent': userAgent,
			...customHeaders,
		},
		proxy: proxyConfig,
	});

	const htmlContent = response.data;

	// Extract main content if requested
	let content = htmlContent;
	let metadata: IDataObject = {};

	if (outputOptions.extractMainContent !== false) {
		const dom = new JSDOM(htmlContent, { url });
		const reader = new Readability(dom.window.document);
		const article = reader.parse();

		if (article) {
			content = article.content;
			metadata = {
				title: article.title,
				author: article.byline,
				excerpt: article.excerpt,
				siteName: article.siteName,
				length: article.length,
			};
		}
	}

	// Convert to requested format
	return formatContent(content, outputOptions, metadata);
}

async function scrapeWithJina(
	this: IExecuteFunctions,
	url: string,
	advancedOptions: IDataObject,
	outputOptions: IDataObject,
	failoverOptions: IDataObject,
): Promise<IDataObject> {
	const timeout = (advancedOptions.timeout as number) || 30000;

	let jinaHost = (failoverOptions.jinaApiHost as string) || 'https://r.jina.ai';
	let headers: IDataObject = {};

	if (failoverOptions.jinaApiKey) {
		headers['Authorization'] = `Bearer ${failoverOptions.jinaApiKey}`;
	}

	const response = await axios.get(`${jinaHost}/${url}`, {
		timeout,
		headers: headers as any,
	});

	const content = response.data;

	// Jina returns markdown by default
	return formatContent(content, outputOptions, {});
}

async function scrapeWithFirecrawl(
	this: IExecuteFunctions,
	url: string,
	advancedOptions: IDataObject,
	outputOptions: IDataObject,
	failoverOptions: IDataObject,
): Promise<IDataObject> {
	const apiHost = (failoverOptions.firecrawlApiHost as string) || 'https://api.firecrawl.dev';
	const apiKey = failoverOptions.firecrawlApiKey as string;

	if (!apiKey) {
		throw new Error('Firecrawl API key is required');
	}

	const requestOptions: IHttpRequestOptions = {
		method: 'POST',
		url: `${apiHost}/v0/scrape`,
		headers: {
			'Authorization': `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
		},
		body: {
			url,
			formats: [outputOptions.format || 'markdown'],
			onlyMainContent: outputOptions.extractMainContent !== false,
		},
		json: true,
		timeout: (advancedOptions.timeout as number) || 30000,
	};

	const response = await this.helpers.httpRequest.call(this, requestOptions);

	// Firecrawl returns data in a nested structure
	const data = response.data || response;

	return {
		content: data.markdown || data.content || data.text || '',
		metadata: data.metadata || {},
	};
}

function formatContent(
	content: string,
	outputOptions: IDataObject,
	metadata: IDataObject,
): IDataObject {
	const format = (outputOptions.format as string) || 'markdown';
	const maxLength = outputOptions.maxLength as number;
	const includeMetadata = outputOptions.includeMetadata !== false;

	let formattedContent = content;

	// Convert HTML to markdown if needed
	if (format === 'markdown' && content.includes('<') && content.includes('>')) {
		const turndownService = new TurndownService({
			headingStyle: 'atx',
			codeBlockStyle: 'fenced',
		});
		formattedContent = turndownService.turndown(content);
	} else if (format === 'text') {
		// Strip HTML tags for text format
		const dom = new JSDOM(content);
		formattedContent = dom.window.document.body?.textContent || content;
	}

	// Apply length limit if specified
	if (maxLength && maxLength > 0 && formattedContent.length > maxLength) {
		formattedContent = formattedContent.substring(0, maxLength) + '...';
	}

	const result: IDataObject = {
		content: formattedContent,
	};

	if (includeMetadata) {
		result.metadata = metadata;
	}

	if (format === 'json') {
		return {
			...result,
			...metadata,
		};
	}

	return result;
}

export class SmartWebScraper implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Smart Web Scraper',
		name: 'smartWebScraper',
		icon: 'file:SmartWebScraper.node.svg',
		group: ['input'],
		version: 1,
		subtitle: '={{$parameter["strategy"]}}',
		description: 'Intelligent web scraper with automatic failover and content extraction. Attempts multiple scraping methods to ensure success, automatically extracting clean, main content from web pages.',
		defaults: {
			name: 'Smart Web Scraper',
		},
		inputs: [NodeConnectionType.Main],
		outputs: [NodeConnectionType.Main],
		credentials: [],
		properties: [
			{
				displayName: 'URLs',
				name: 'urls',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'https://example.com/article, https://example.com/page2',
				description: 'The URL(s) to scrape. Separate multiple URLs with commas or new lines.',
				typeOptions: {
					rows: 3,
				},
			},
			{
				displayName: 'Scraping Strategy',
				name: 'strategy',
				type: 'options',
				options: [
					{
						name: 'Cost Effective',
						value: 'cost_effective',
						description: 'Try free methods first (HTTP GET → Jina → Firecrawl)',
					},
					{
						name: 'Speed First',
						value: 'speed_first',
						description: 'Use fastest available method',
					},
					{
						name: 'Quality First',
						value: 'quality_first',
						description: 'Start with premium APIs for best extraction',
					},
				],
				default: 'cost_effective',
				description: 'Strategy for attempting different scraping methods',
			},
			{
				displayName: 'Failover Options',
				name: 'failoverOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Enable Firecrawl',
						name: 'enableFirecrawl',
						type: 'boolean',
						default: false,
						description: 'Whether to use Firecrawl API as a failover option',
					},
					{
						displayName: 'Firecrawl API Key',
						name: 'firecrawlApiKey',
						type: 'string',
						typeOptions: {
							password: true,
						},
						default: '',
						placeholder: 'fc-...',
						description: 'Your Firecrawl API key',
						displayOptions: {
							show: {
								enableFirecrawl: [true],
							},
						},
					},
					{
						displayName: 'Firecrawl API Host',
						name: 'firecrawlApiHost',
						type: 'string',
						default: 'https://api.firecrawl.dev',
						description: 'The base URL of the Firecrawl API',
						displayOptions: {
							show: {
								enableFirecrawl: [true],
							},
						},
					},
					{
						displayName: 'Enable Jina AI',
						name: 'enableJina',
						type: 'boolean',
						default: true,
						description: 'Whether to use Jina AI Reader as a failover option',
					},
					{
						displayName: 'Jina API Key',
						name: 'jinaApiKey',
						type: 'string',
						typeOptions: {
							password: true,
						},
						default: '',
						placeholder: 'jina_...',
						description: 'Your Jina API key (optional, for paid tier)',
						displayOptions: {
							show: {
								enableJina: [true],
							},
						},
					},
					{
						displayName: 'Jina API Host',
						name: 'jinaApiHost',
						type: 'string',
						default: 'https://r.jina.ai',
						description: 'The base URL of the Jina Reader API',
						displayOptions: {
							show: {
								enableJina: [true],
							},
						},
					},
					{
						displayName: 'Enable Proxy',
						name: 'enableProxy',
						type: 'boolean',
						default: false,
						description: 'Whether to use proxy server for requests',
					},
					{
						displayName: 'Proxy Host',
						name: 'proxyHost',
						type: 'string',
						default: '',
						placeholder: 'proxy.example.com',
						description: 'Proxy server hostname or IP',
						displayOptions: {
							show: {
								enableProxy: [true],
							},
						},
					},
					{
						displayName: 'Proxy Port',
						name: 'proxyPort',
						type: 'number',
						default: 8080,
						description: 'Proxy server port',
						displayOptions: {
							show: {
								enableProxy: [true],
							},
						},
					},
					{
						displayName: 'Proxy Protocol',
						name: 'proxyProtocol',
						type: 'options',
						options: [
							{
								name: 'HTTP',
								value: 'http',
							},
							{
								name: 'HTTPS',
								value: 'https',
							},
							{
								name: 'SOCKS5',
								value: 'socks5',
							},
						],
						default: 'http',
						description: 'Proxy protocol',
						displayOptions: {
							show: {
								enableProxy: [true],
							},
						},
					},
					{
						displayName: 'Proxy Username',
						name: 'proxyUsername',
						type: 'string',
						default: '',
						description: 'Proxy authentication username (optional)',
						displayOptions: {
							show: {
								enableProxy: [true],
							},
						},
					},
					{
						displayName: 'Proxy Password',
						name: 'proxyPassword',
						type: 'string',
						typeOptions: {
							password: true,
						},
						default: '',
						description: 'Proxy authentication password (optional)',
						displayOptions: {
							show: {
								enableProxy: [true],
							},
						},
					},
				],
			},
			{
				displayName: 'Output Options',
				name: 'outputOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Output Format',
						name: 'format',
						type: 'options',
						options: [
							{
								name: 'Markdown',
								value: 'markdown',
								description: 'Clean markdown format',
							},
							{
								name: 'Text',
								value: 'text',
								description: 'Plain text without formatting',
							},
							{
								name: 'HTML',
								value: 'html',
								description: 'Cleaned HTML content',
							},
							{
								name: 'JSON',
								value: 'json',
								description: 'Structured JSON with metadata',
							},
						],
						default: 'markdown',
						description: 'Output format for the scraped content',
					},
					{
						displayName: 'Max Content Length',
						name: 'maxLength',
						type: 'number',
						default: 0,
						description: 'Maximum content length in characters (0 for unlimited)',
					},
					{
						displayName: 'Include Metadata',
						name: 'includeMetadata',
						type: 'boolean',
						default: true,
						description: 'Whether to include metadata like title, author, and publish date',
					},
					{
						displayName: 'Extract Main Content Only',
						name: 'extractMainContent',
						type: 'boolean',
						default: true,
						description: 'Whether to extract only the main article content (removes navigation, ads, etc.)',
					},
				],
			},
			{
				displayName: 'Advanced Options',
				name: 'advancedOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'User Agent',
						name: 'userAgent',
						type: 'string',
						default: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
						description: 'User agent string to use for HTTP requests',
					},
					{
						displayName: 'Timeout',
						name: 'timeout',
						type: 'number',
						default: 30000,
						description: 'Request timeout in milliseconds',
					},
					{
						displayName: 'Retry Count',
						name: 'retryCount',
						type: 'number',
						default: 2,
						description: 'Number of retry attempts per method',
					},
					{
						displayName: 'Custom Headers',
						name: 'headers',
						type: 'json',
						default: '{}',
						description: 'Additional headers to send with requests',
					},
				],
			},
		],
		// Enable AI tool usage
		usableAsTool: true,
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const urlsInput = this.getNodeParameter('urls', i) as string;
				const strategy = this.getNodeParameter('strategy', i) as string;
				const failoverOptions = this.getNodeParameter('failoverOptions', i) as IDataObject;
				const outputOptions = this.getNodeParameter('outputOptions', i) as IDataObject;
				const advancedOptions = this.getNodeParameter('advancedOptions', i) as IDataObject;

				// Parse URLs - handle both single URL and comma-separated URLs
				// Also handle newline-separated URLs for better flexibility
				const urls = urlsInput
					.split(/[,\n]+/)
					.map(url => url.trim())
					.filter(url => url && url.length > 0);

				// If no valid URLs found, throw error
				if (urls.length === 0) {
					throw new NodeOperationError(
						this.getNode(),
						'No valid URLs provided',
						{ itemIndex: i }
					);
				}

				for (const url of urls) {
					let scrapedData: IDataObject | null = null;
					let usedMethod = '';
					const errors: string[] = [];

					// Determine scraping order based on strategy
					const methods = getScrapingOrder(strategy, failoverOptions);

					// Try each method until one succeeds
					for (const method of methods) {
						try {
							switch (method) {
								case 'http':
									scrapedData = await scrapeWithHttp.call(this, url, advancedOptions, outputOptions, failoverOptions);
									usedMethod = 'HTTP GET with content extraction';
									break;
								case 'jina':
									scrapedData = await scrapeWithJina.call(this, url, advancedOptions, outputOptions, failoverOptions);
									usedMethod = 'Jina AI Reader';
									break;
								case 'firecrawl':
									scrapedData = await scrapeWithFirecrawl.call(this, url, advancedOptions, outputOptions, failoverOptions);
									usedMethod = 'Firecrawl API';
									break;
							}

							if (scrapedData) {
								break;
							}
						} catch (error) {
							errors.push(`${method}: ${(error as Error).message}`);
							continue;
						}
					}

					if (!scrapedData) {
						if (this.continueOnFail()) {
							const executionData = this.helpers.constructExecutionMetaData(
								this.helpers.returnJsonArray({
									error: `Failed to scrape URL with all available methods. Errors: ${errors.join('; ')}`,
									url: url
								}),
								{ itemData: { item: i } },
							);
							returnData.push(...executionData);
							continue;
						}
						throw new NodeOperationError(
							this.getNode(),
							`Failed to scrape URL ${url} with all available methods. Errors: ${errors.join('; ')}`,
							{ itemIndex: i }
						);
					}

					// Add metadata about the scraping process
					scrapedData.scrapingMethod = usedMethod;
					scrapedData.url = url;
					scrapedData.timestamp = new Date().toISOString();

					const executionData = this.helpers.constructExecutionMetaData(
						this.helpers.returnJsonArray(scrapedData),
						{ itemData: { item: i } },
					);
					returnData.push(...executionData);
				}
			} catch (error) {
				if (this.continueOnFail()) {
					const executionData = this.helpers.constructExecutionMetaData(
						this.helpers.returnJsonArray({ error: (error as Error).message }),
						{ itemData: { item: i } },
					);
					returnData.push(...executionData);
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}