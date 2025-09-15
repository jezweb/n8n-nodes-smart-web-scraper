import { ICredentialType, INodeProperties } from 'n8n-workflow';

export class FirecrawlApi implements ICredentialType {
	name = 'firecrawlApi';
	displayName = 'Firecrawl API';
	documentationUrl = 'https://docs.firecrawl.dev/';
	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true,
			placeholder: 'fc-...',
			description: 'Your Firecrawl API key',
		},
		{
			displayName: 'API Host',
			name: 'apiHost',
			type: 'string',
			default: 'https://api.firecrawl.dev',
			description: 'The base URL of the Firecrawl API',
		},
	];
	authenticate = {
		type: 'generic',
		properties: {
			headers: {
				'Authorization': 'Bearer {{$credentials.apiKey}}',
			},
		},
	} as const;
}