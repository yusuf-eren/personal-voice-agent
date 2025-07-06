import 'dotenv/config';
import { OpenAI } from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export const generateText = async (
  prompt: string,
  model: string = 'gpt-4o-mini',
  stream: boolean = false
) => {
  return openai.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    stream
  });
};
