import OpenAI from "openai";
import { writeFileSync, readFileSync } from "fs";

interface Message {
  role: "user" | "assistant" | "tool";
  content?: string | null;
  tool_call_id?: string | null;
}

async function main() {
  const [, , flag, prompt] = process.argv;
  const apiKey = process.env.OPENROUTER_API_KEY;
  const baseURL =
    process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }
  if (flag !== "-p" || !prompt) {
    throw new Error("error: -p flag is required");
  }

  const client = new OpenAI({
    apiKey: apiKey,
    baseURL: baseURL,
  });

  const readTool = {
    type: "function",
    function: {
      name: "Read",
      description: "Read content from a file",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "The path to the file to read"
          }
        },
        required: ["file_path"]
      },
    },
  };

  const writeTool = {
    type: "function",
    function: {
      name: "Write",
      description: "Write content to a file",
      parameters: {
        type: "object",
        required: ["file_path", "content"],
        properties: {
          file_path: {
            type: "string",
            description: "The path of the file to write to"
          },
          content: {
            type: "string",
            description: "The content to write to the file"
          }
        }
      },
    },
  };

  const readToolCall = ({ file_path }: { file_path: string }) => {
    return readFileSync(file_path, 'utf8');
  }

  const writeToolCall = ({ file_path, content }: { file_path: string, content: string }) => {
    return writeFileSync(file_path, content);
  }

  const messages: Message[] = [{ role: "user", content: prompt }];
  const tools = [readTool, writeTool];

  while (true) {
    const response = await client.chat.completions.create({
      model: "anthropic/claude-haiku-4.5",
      messages: messages,
      tools: tools,
    });

    if (!response.choices || response.choices.length === 0) {
      throw new Error("no choices in response");
    }

    messages.push({
      role: "assistant",
      content: response.choices[0].message.content ?? null,
      ...(response.choices[0].message.tool_calls ? {tool_calls: response.choices[0].message.tool_calls} : {})
    });

    const toolCalls = response.choices[0].message.tool_calls;

    if (!toolCalls || toolCalls.length === 0) {
      break;
    }

    for (const toolCall of toolCalls) {
      if (toolCall.type === "function") {
        const functionName = toolCall.function.name;
        const tool = tools.find(
            (tool) => tool.function.name === functionName,
        );
        if (!tool) {
          continue;
        }

        const args = JSON.parse(toolCall.function.arguments);
        let result = null;
        if (toolCall.function.name === "Read") {
          result = readToolCall(args);
        }

        if (toolCall.function.name === "Write") {
          result = writeToolCall(args);
        }

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
    }

    if (response.choices[0].message.content) {
      console.log(response.choices[0].message.content);
      break;
    }
  }
}

main();
