import { describe, it, expect } from 'vitest';
import {
  analyzeResources,
  parseResourceQuantity,
  formatRecommendation,
  type PodResourceData,
  type PodMetricsData,
} from '../../src/analysis/resourceAnalyzer';

describe('resourceAnalyzer', () => {
  describe('parseResourceQuantity', () => {
    it('should parse CPU millicores', () => {
      expect(parseResourceQuantity('100m')).toBe(0.1);
      expect(parseResourceQuantity('500m')).toBe(0.5);
      expect(parseResourceQuantity('1000m')).toBe(1);
    });

    it('should parse CPU cores', () => {
      expect(parseResourceQuantity('1')).toBe(1);
      expect(parseResourceQuantity('2')).toBe(2);
      expect(parseResourceQuantity('0.5')).toBe(0.5);
    });

    it('should parse memory in different units', () => {
      expect(parseResourceQuantity('128Mi')).toBe(128 * 1024 * 1024);
      expect(parseResourceQuantity('1Gi')).toBe(1024 * 1024 * 1024);
      expect(parseResourceQuantity('256Ki')).toBe(256 * 1024);
    });

    it('should handle nano units (metrics-server format)', () => {
      expect(parseResourceQuantity('100000000n')).toBe(0.1);
      expect(parseResourceQuantity('500000000n')).toBe(0.5);
    });
  });

  describe('analyzeResources', () => {
    it('should detect over-provisioned resources', () => {
      const resources: PodResourceData = {
        name: 'my-pod',
        containers: [
          {
            name: 'main',
            requests: { cpu: '500m', memory: '512Mi' },
            limits: { cpu: '1', memory: '1Gi' },
          },
        ],
      };

      const metrics: PodMetricsData = {
        name: 'my-pod',
        containers: [
          {
            name: 'main',
            usage: { cpu: '50m', memory: '128Mi' },
          },
        ],
      };

      const analysis = analyzeResources(resources, metrics);

      expect(analysis.status).toBe('over-provisioned');
      expect(analysis.recommendations.length).toBeGreaterThan(0);
      expect(analysis.recommendations[0]!.type).toBe('reduce');
    });

    it('should detect under-provisioned resources', () => {
      const resources: PodResourceData = {
        name: 'my-pod',
        containers: [
          {
            name: 'main',
            requests: { cpu: '100m', memory: '128Mi' },
            limits: { cpu: '200m', memory: '256Mi' },
          },
        ],
      };

      const metrics: PodMetricsData = {
        name: 'my-pod',
        containers: [
          {
            name: 'main',
            usage: { cpu: '180m', memory: '240Mi' },
          },
        ],
      };

      const analysis = analyzeResources(resources, metrics);

      expect(analysis.status).toBe('under-provisioned');
      expect(analysis.recommendations.some(r => r.type === 'increase')).toBe(true);
    });

    it('should detect properly sized resources', () => {
      const resources: PodResourceData = {
        name: 'my-pod',
        containers: [
          {
            name: 'main',
            requests: { cpu: '200m', memory: '256Mi' },
            limits: { cpu: '400m', memory: '512Mi' },
          },
        ],
      };

      const metrics: PodMetricsData = {
        name: 'my-pod',
        containers: [
          {
            name: 'main',
            usage: { cpu: '150m', memory: '200Mi' },
          },
        ],
      };

      const analysis = analyzeResources(resources, metrics);

      expect(analysis.status).toBe('right-sized');
      expect(analysis.recommendations).toHaveLength(0);
    });

    it('should detect missing limits', () => {
      const resources: PodResourceData = {
        name: 'my-pod',
        containers: [
          {
            name: 'main',
            requests: { cpu: '100m', memory: '128Mi' },
            // No limits
          },
        ],
      };

      const metrics: PodMetricsData = {
        name: 'my-pod',
        containers: [
          {
            name: 'main',
            usage: { cpu: '50m', memory: '64Mi' },
          },
        ],
      };

      const analysis = analyzeResources(resources, metrics);

      expect(analysis.warnings.some(w => w.includes('limit'))).toBe(true);
    });

    it('should detect missing requests', () => {
      const resources: PodResourceData = {
        name: 'my-pod',
        containers: [
          {
            name: 'main',
            // No requests or limits
          },
        ],
      };

      const metrics: PodMetricsData = {
        name: 'my-pod',
        containers: [
          {
            name: 'main',
            usage: { cpu: '50m', memory: '64Mi' },
          },
        ],
      };

      const analysis = analyzeResources(resources, metrics);

      expect(analysis.warnings.some(w => w.includes('request'))).toBe(true);
    });
  });

  describe('formatRecommendation', () => {
    it('should format a reduce recommendation', () => {
      const recommendation = formatRecommendation({
        type: 'reduce',
        resource: 'memory',
        containerName: 'main',
        currentRequest: '512Mi',
        currentLimit: '1Gi',
        suggestedRequest: '256Mi',
        suggestedLimit: '512Mi',
        reason: 'Using only 128Mi of 512Mi requested',
      });

      expect(recommendation).toContain('main');
      expect(recommendation).toContain('memory');
      expect(recommendation.toLowerCase()).toContain('reduce');
    });
  });
});
