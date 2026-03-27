import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  paymentSessionZodSchema,
  registerMerchantZodSchema,
} from './lib/request-schemas.js';

export const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'Stellar Payment API',
    version: '0.1.0',
    description: 'API for creating and verifying Stellar network payments',
  },
  servers: [{ url: 'http://localhost:4000' }],
  paths: {
    '/api/create-payment': {
      post: {
        summary: 'Create a new payment session request',
        tags: ['Payments'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: zodToJsonSchema(paymentSessionZodSchema, {
                name: 'PaymentSession',
                $refStrategy: 'none',
              }),
            },
          },
        },
        responses: {
          201: {
            description: 'Payment created',
          },
          400: {
            description: 'Validation error',
          },
          429: {
            description: 'Too many requests',
          },
        },
      },
    },
    '/api/sessions': {
      post: {
        summary: 'Create a new payment session request',
        tags: ['Payments'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: zodToJsonSchema(paymentSessionZodSchema, {
                name: 'PaymentSession',
                $refStrategy: 'none',
              }),
            },
          },
        },
        responses: {
          201: { description: 'Payment created' },
          400: { description: 'Validation error' },
          429: { description: 'Too many requests' },
        },
      },
    },
    '/api/merchant-branding': {
      put: {
        summary: 'Update merchant branding config',
        tags: ['Merchants'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: zodToJsonSchema(registerMerchantZodSchema, {
                name: 'MerchantBrandingUpdate',
                $refStrategy: 'none',
              }),
            },
          },
        },
        responses: {
          200: { description: 'Branding updated' },
        },
      },
    },
  },
};