import { z } from 'zod';
import { insertGameResultSchema, gameResults } from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  gameResults: {
    list: {
      method: 'GET' as const,
      path: '/api/game-results' as const,
      responses: {
        200: z.array(z.custom<typeof gameResults.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/game-results' as const,
      input: insertGameResultSchema,
      responses: {
        201: z.custom<typeof gameResults.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
  },
  marketBook: {
    get: {
      method: 'GET' as const,
      path: '/api/market-book' as const,
      responses: {
        200: z.array(z.array(z.object({ s: z.number(), f: z.number() }))),
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
