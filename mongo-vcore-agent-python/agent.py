import asyncio
import os
from agent_framework.azure import AzureOpenAIChatClient
from azure.identity import DefaultAzureCredential

# Get token directly for Azure AI scope
credential = DefaultAzureCredential()
token = credential.get_token("https://ai.azure.com/.default")

# Use the token for Azure AI Foundry
agent = AzureOpenAIChatClient(
    endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
    deployment_name=os.getenv("AZURE_OPENAI_CHAT_DEPLOYMENT_NAME"),
    api_version=os.getenv("AZURE_OPENAI_API_VERSION"),
    api_key="",
    #token=token.token
).create_agent(
    instructions="You are good at telling jokes.",
    name="Joker"
)

async def main():
    result = await agent.run("Tell me a joke about a pirate.")
    print(result.text)

if __name__ == "__main__":
    asyncio.run(main())