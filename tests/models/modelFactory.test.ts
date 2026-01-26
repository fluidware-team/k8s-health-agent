import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createModel, parseModelSpec, type ModelSpec } from '../../src/models/modelFactory';

describe('modelFactory', () => {
  describe('parseModelSpec', () => {
    it('should parse OpenAI model spec', () => {
      const spec = parseModelSpec('openai/gpt-4');

      expect(spec.provider).toBe('openai');
      expect(spec.model).toBe('gpt-4');
    });

    it('should parse Ollama model spec', () => {
      const spec = parseModelSpec('ollama/llama2');

      expect(spec.provider).toBe('ollama');
      expect(spec.model).toBe('llama2');
    });

    it('should default to OpenAI provider when no provider specified', () => {
      const spec = parseModelSpec('gpt-3.5-turbo');

      expect(spec.provider).toBe('openai');
      expect(spec.model).toBe('gpt-3.5-turbo');
    });

    it('should handle model names with multiple slashes', () => {
      const spec = parseModelSpec('ollama/codellama/7b');

      expect(spec.provider).toBe('ollama');
      expect(spec.model).toBe('codellama/7b');
    });
  });

  describe('createModel', () => {
    it('should create an OpenAI model by default', () => {
      const model = createModel();

      expect(model).toBeDefined();
    });

    it('should create a model from spec string', () => {
      const model = createModel('openai/gpt-4');

      expect(model).toBeDefined();
    });

    it('should create a model from ModelSpec object', () => {
      const spec: ModelSpec = { provider: 'openai', model: 'gpt-4' };
      const model = createModel(spec);

      expect(model).toBeDefined();
    });

    it('should throw for unsupported provider', () => {
      expect(() => createModel('unsupported/model')).toThrow('Unsupported provider');
    });
  });
});
