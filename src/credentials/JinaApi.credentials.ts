import { ICredentialType, INodeProperties } from 'n8n-workflow';

export class JinaApi implements ICredentialType {
	name = 'jinaApi';
	displayName = 'Jina AI Reader API';
	documentationUrl = 'https://jina.ai/reader/';
	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: false,
			placeholder: 'jina_...',
			description: 'Your Jina AI API key (optional for basic usage)',
		},
		{
			displayName: 'API Host',
			name: 'apiHost',
			type: 'string',
			default: 'https://r.jina.ai',
			description: 'The base URL of the Jina Reader API',
		},
	];
	authenticate = {
		type: 'generic',
		properties: {
			headers: {
				'Authorization': '={{$credentials.apiKey ? "Bearer " + $credentials.apiKey : ""}}',
			},
		},
	} as const;
}