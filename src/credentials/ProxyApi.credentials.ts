import { ICredentialType, INodeProperties } from 'n8n-workflow';

export class ProxyApi implements ICredentialType {
	name = 'proxyApi';
	displayName = 'Proxy Server';
	documentationUrl = '';
	properties: INodeProperties[] = [
		{
			displayName: 'Proxy Host',
			name: 'host',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'proxy.example.com or 192.168.1.1',
			description: 'The proxy server hostname or IP address',
		},
		{
			displayName: 'Port',
			name: 'port',
			type: 'number',
			default: 8080,
			required: true,
			placeholder: '8080',
			description: 'The proxy server port',
		},
		{
			displayName: 'Protocol',
			name: 'protocol',
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
			description: 'The proxy protocol to use',
		},
		{
			displayName: 'Username',
			name: 'username',
			type: 'string',
			default: '',
			required: false,
			placeholder: 'username',
			description: 'Username for proxy authentication (if required)',
		},
		{
			displayName: 'Password',
			name: 'password',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: false,
			placeholder: 'password',
			description: 'Password for proxy authentication (if required)',
		},
	];
}