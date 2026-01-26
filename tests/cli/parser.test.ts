import { describe, it, expect } from 'vitest';
import { parseArgs, type CliArgs } from '../../src/cli/parser';

describe('CLI Parser', () => {
  describe('parseArgs', () => {
    it('should return default values when no arguments provided', () => {
      const args = parseArgs([]);

      expect(args.namespace).toBe('default');
      expect(args.context).toBeUndefined();
      expect(args.resume).toBe(false);
      expect(args.chat).toBe(false);
      expect(args.model).toBeUndefined();
    });

    it('should parse namespace as first positional argument', () => {
      const args = parseArgs(['kube-system']);

      expect(args.namespace).toBe('kube-system');
    });

    it('should parse --context flag', () => {
      const args = parseArgs(['--context', 'prod-cluster']);

      expect(args.context).toBe('prod-cluster');
    });

    it('should parse -c shorthand for context', () => {
      const args = parseArgs(['-c', 'staging-cluster']);

      expect(args.context).toBe('staging-cluster');
    });

    it('should parse --resume flag', () => {
      const args = parseArgs(['--resume']);

      expect(args.resume).toBe(true);
    });

    it('should parse -r shorthand for resume', () => {
      const args = parseArgs(['-r']);

      expect(args.resume).toBe(true);
    });

    it('should parse combined arguments', () => {
      const args = parseArgs(['monitoring', '--context', 'dev-cluster', '--resume']);

      expect(args.namespace).toBe('monitoring');
      expect(args.context).toBe('dev-cluster');
      expect(args.resume).toBe(true);
    });

    it('should parse namespace after flags', () => {
      const args = parseArgs(['--context', 'my-cluster', 'my-namespace']);

      expect(args.namespace).toBe('my-namespace');
      expect(args.context).toBe('my-cluster');
    });

    it('should handle = syntax for context', () => {
      const args = parseArgs(['--context=prod']);

      expect(args.context).toBe('prod');
    });

    it('should parse --chat flag', () => {
      const args = parseArgs(['--chat']);

      expect(args.chat).toBe(true);
    });

    it('should parse --model flag', () => {
      const args = parseArgs(['--model', 'gpt-4']);

      expect(args.model).toBe('gpt-4');
    });

    it('should parse -m shorthand for model', () => {
      const args = parseArgs(['-m', 'ollama/llama2']);

      expect(args.model).toBe('ollama/llama2');
    });

    it('should handle = syntax for model', () => {
      const args = parseArgs(['--model=gpt-3.5-turbo']);

      expect(args.model).toBe('gpt-3.5-turbo');
    });

    it('should parse all flags together', () => {
      const args = parseArgs(['monitoring', '--context', 'prod', '--chat', '--model', 'gpt-4', '--resume']);

      expect(args.namespace).toBe('monitoring');
      expect(args.context).toBe('prod');
      expect(args.chat).toBe(true);
      expect(args.model).toBe('gpt-4');
      expect(args.resume).toBe(true);
    });
  });
});
