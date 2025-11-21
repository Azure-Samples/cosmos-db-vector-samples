import { OIDCResponse, OIDCCallbackParams } from 'mongodb';
import { AccessToken, DefaultAzureCredential, TokenCredential, getBearerTokenProvider} from '@azure/identity';

const OPENAI_SCOPE = 'https://cognitiveservices.azure.com/.default';
const DOCUMENT_DB_SCOPE = 'https://ossrdbms-aad.database.windows.net/.default';

// Your Azure identity credential
export const CREDENTIAL = new DefaultAzureCredential();

// Used in MongoClient
export const AzureIdentityTokenCallback = async (params: OIDCCallbackParams, credential: TokenCredential): Promise<OIDCResponse> => {
  const tokenResponse: AccessToken | null = await credential.getToken([DOCUMENT_DB_SCOPE]);
  return {
    accessToken: tokenResponse?.token || '',
    expiresInSeconds: (tokenResponse?.expiresOnTimestamp || 0) - Math.floor(Date.now() / 1000)
  };
};

// Used in OpenAI clients
export const AZURE_OPENAI_AD_TOKEN_PROVIDER = getBearerTokenProvider(CREDENTIAL, OPENAI_SCOPE);