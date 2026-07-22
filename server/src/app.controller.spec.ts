import { describe, it, expect, beforeEach } from 'vitest';
import { AppController } from './app.controller';

describe('AppController', () => {
  let controller: AppController;

  beforeEach(() => {
    controller = new AppController();
  });

  describe('health', () => {
    it('should return status ok', () => {
      const result = controller.health();

      expect(result).toHaveProperty('status', 'ok');
    });

    it('should return an ISO timestamp', () => {
      const result = controller.health();

      expect(result).toHaveProperty('timestamp');
      expect(typeof result.timestamp).toBe('string');
      // Verify it's a valid ISO date string
      expect(() => new Date(result.timestamp)).not.toThrow();
      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    });

    it('should return a fresh timestamp each call', async () => {
      const result1 = controller.health();
      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 10));
      const result2 = controller.health();

      expect(result1.timestamp).not.toBe(result2.timestamp);
    });
  });
});